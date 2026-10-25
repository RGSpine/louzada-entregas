import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppointmentSource } from "@prisma/client";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { prisma } from "@/lib/prisma";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import { logger } from "@/lib/logger";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  resolveAudioMime,
} from "@/lib/evolution-hybrid";
import { extractSchedulingIntent } from "@/lib/scheduling-ai-extract";
import { describeMissingCommandData } from "@/lib/scheduling-command-plan";
import { applySchedulingIntent } from "@/server/services/agenda-voice-commands";
import { canUseAgendaIntake } from "@/lib/plan-limits";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import { scopedPatientWhereOrEmpty } from "@/lib/intra-user/patient-scope";

export const maxDuration = 300;

const IntakeFormSchema = z.object({
  mode: z.literal("audio"),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const rl = await enforceAiBillingRateLimit({
      userKey: authUser.email.toLowerCase(),
      ip: getRequestClientIp(request.headers),
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: aiBillingRateLimitMessage(rl.resetIn) },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email }],
      },
      select: { id: true, plan: true, email: true, isInfluencer: true },
    });
    if (!dbUser) {
      return NextResponse.json({ error: "Utilizador não encontrado." }, { status: 403 });
    }
    if (!canUseAgendaIntake(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return NextResponse.json(
        { error: "Agenda por áudio está disponível no plano Profissional. Faça upgrade para continuar." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const parsedForm = IntakeFormSchema.safeParse({
      mode: formData.get("mode"),
    });
    if (!parsedForm.success) {
      return NextResponse.json(
        { error: "Envie um áudio de comando (mode=audio). Foto/imagem não é suportada." },
        { status: 400 },
      );
    }

    const audioFile = formData.get("audio");
    if (!(audioFile instanceof File) || audioFile.size === 0) {
      return NextResponse.json({ error: "Áudio não enviado." }, { status: 400 });
    }
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Áudio excede 40 MB." }, { status: 400 });
    }
    const mime = resolveAudioMime(audioFile);
    if (!ALLOWED_AUDIO_MIME.has(mime)) {
      return NextResponse.json({ error: `Tipo de áudio não permitido: ${mime}` }, { status: 400 });
    }
    const buf = Buffer.from(await audioFile.arrayBuffer());
    const audio = { base64: buf.toString("base64"), mimeType: mime };

    const scope = await getPatientAccessScope();
    if (!scope || scope.denied) {
      return NextResponse.json(
        { error: "Selecione o perfil profissional para continuar." },
        { status: 403 },
      );
    }

    const patients = await prisma.patient.findMany({
      where: {
        ...scopedPatientWhereOrEmpty(dbUser.id, scope),
        ...clinicalPatientWhere,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    const catalogServices = await prisma.professionalService.findMany({
      where: { userId: dbUser.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultPriceCents: true },
    });

    const resources = await prisma.serviceSpace.findMany({
      where: { userId: dbUser.id, active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    });

    const extracted = await extractSchedulingIntent({
      patients,
      services: catalogServices,
      resources,
      audio,
    });
    if (!extracted.ok) {
      return NextResponse.json({ error: extracted.error }, { status: 502 });
    }

    const model = extracted.data;
    if (model.action === "none") {
      return NextResponse.json({
        ok: true,
        action: null,
        created: [],
        rescheduled: [],
        cancelled: [],
        renamed: [],
        noShows: [],
        errors: [],
        newPatientNames: [],
        issues: [],
        summary: model.transcriptOrSummary ?? "Nenhum agendamento identificado.",
        confidenceOverall: model.confidenceOverall,
      });
    }

    const outcome = await applySchedulingIntent({
      professionalUserId: dbUser.id,
      patients,
      model,
      source: AppointmentSource.VOICE,
      catalogServices,
      resources,
      activeIntraUser: scope.activeIntraUser,
    });

    if (!outcome.plan.hasWork) {
      return NextResponse.json(
        {
          ok: false,
          error: describeMissingCommandData(outcome.plan.action),
          summary: model.transcriptOrSummary,
          confidenceOverall: model.confidenceOverall,
        },
        { status: 422 },
      );
    }

    const touched =
      outcome.created.length +
      outcome.rescheduled.length +
      outcome.cancelled.length +
      outcome.renamed.length +
      outcome.noShows.length;

    return NextResponse.json({
      ok: touched > 0 || outcome.errors.length === 0,
      action: outcome.plan.action,
      created: outcome.created,
      rescheduled: outcome.rescheduled,
      cancelled: outcome.cancelled,
      renamed: outcome.renamed,
      noShows: outcome.noShows,
      errors: outcome.errors,
      newPatientNames: outcome.newPatientNames,
      issues: outcome.issues.map((issue) => ({
        message: issue.message,
        suggestedSlots: issue.suggestedSlots?.map((s) => ({
          startUtc: s.startUtc.toISOString(),
          endUtc: s.endUtc.toISOString(),
          label: s.label,
        })),
      })),
      summary: model.transcriptOrSummary,
      confidenceOverall: model.confidenceOverall,
    });
  } catch (err) {
    logger.error("API agenda/intake falhou", { err });
    return NextResponse.json({ error: "Erro interno ao processar agendamento." }, { status: 500 });
  }
}
