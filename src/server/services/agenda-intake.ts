import { z } from "zod";
import { AppointmentSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  resolveAudioMime,
} from "@/lib/evolution-hybrid";
import { extractSchedulingIntent } from "@/lib/scheduling-ai-extract";
import { describeMissingCommandData } from "@/lib/scheduling-command-plan";
import { applySchedulingIntent } from "@/server/services/agenda-voice-commands";
import { canUseAgendaIntake } from "@/lib/plan-limits";
import type { DocumentsUserContext } from "@/server/services/clinical-documents";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import {
  type ActiveIntraUser,
  buildPatientScopeWhere,
} from "@/lib/intra-user/patient-scope";

const IntakeFormSchema = z.object({
  mode: z.literal("audio"),
});

export type AgendaIntakeUser = Pick<
  DocumentsUserContext,
  "id" | "plan" | "email" | "sessionEmail" | "isInfluencer"
>;

export type AgendaIntakeResult =
  | {
      ok: true;
      /** Operação reconhecida no áudio: criar, remarcar, desmarcar, falta, renomear ou yield. */
      action: "create" | "reschedule" | "cancel" | "no_show" | "rename" | "yield" | null;
      created: Array<{ id: string; patientName: string; startAt: string; endAt: string }>;
      rescheduled: Array<{
        id: string;
        patientName: string;
        previousStartAt: string;
        startAt: string;
        endAt: string;
      }>;
      cancelled: Array<{ id: string; patientName: string; startAt: string }>;
      renamed: Array<{
        id: string;
        previousName: string;
        patientName: string;
        startAt: string;
      }>;
      noShows: Array<{
        id: string;
        patientName: string;
        startAt: string;
        noShowReason: string;
      }>;
      errors: string[];
      newPatientNames: string[];
      issues: Array<{
        message: string;
        suggestedSlots?: Array<{ startAt: string; endAt: string; label: string }>;
      }>;
      summary: string | null;
      confidenceOverall: number | null;
    }
  | { ok: false; error: string; status: number; summary?: string | null; confidenceOverall?: number | null };

export async function processAgendaIntakeForUser(
  user: AgendaIntakeUser,
  formData: FormData,
  options?: { activeIntraUser?: ActiveIntraUser | null },
): Promise<AgendaIntakeResult> {
  if (!canUseAgendaIntake(user.plan, user.email, user.isInfluencer)) {
    return {
      ok: false,
      status: 403,
      error:
        "Agenda por áudio está disponível no plano Profissional. Faça upgrade para continuar.",
    };
  }

  const parsedForm = IntakeFormSchema.safeParse({
    mode: formData.get("mode"),
  });
  if (!parsedForm.success) {
    return {
      ok: false,
      status: 400,
      error: "Envie um áudio de comando (mode=audio). Foto/imagem não é suportada.",
    };
  }

  const audioFile = formData.get("audio");
  if (!(audioFile instanceof File) || audioFile.size === 0) {
    return { ok: false, status: 400, error: "Áudio não enviado." };
  }
  if (audioFile.size > MAX_AUDIO_BYTES) {
    return { ok: false, status: 400, error: "Áudio excede 40 MB." };
  }
  const mime = resolveAudioMime(audioFile);
  if (!ALLOWED_AUDIO_MIME.has(mime)) {
    return { ok: false, status: 400, error: `Tipo de áudio não permitido: ${mime}` };
  }
  const buf = Buffer.from(await audioFile.arrayBuffer());
  const audio = { base64: buf.toString("base64"), mimeType: mime };

  let activeIntraUser: ActiveIntraUser | null;
  if (options?.activeIntraUser !== undefined) {
    activeIntraUser = options.activeIntraUser;
  } else {
    const scope = await getPatientAccessScope();
    if (!scope || scope.denied) {
      return {
        ok: false,
        status: 403,
        error: "Selecione o perfil profissional para continuar.",
      };
    }
    activeIntraUser = scope.activeIntraUser;
  }

  const patientScopeWhere = buildPatientScopeWhere({
    tenantId: user.id,
    activeIntraUser,
  });

  const patients = await prisma.patient.findMany({
    where: { ...patientScopeWhere, ...clinicalPatientWhere },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const catalogServices = await prisma.professionalService.findMany({
    where: { userId: user.id, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultPriceCents: true },
  });

  const resources = await prisma.serviceSpace.findMany({
    where: { userId: user.id, active: true },
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
    return { ok: false, status: 502, error: extracted.error };
  }

  const model = extracted.data;
  if (model.action === "none") {
    return {
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
    };
  }

  const outcome = await applySchedulingIntent({
    professionalUserId: user.id,
    patients,
    model,
    source: AppointmentSource.VOICE,
    catalogServices,
    resources,
    activeIntraUser,
  });

  if (!outcome.plan.hasWork) {
    return {
      ok: false,
      status: 422,
      error: describeMissingCommandData(outcome.plan.action),
      summary: model.transcriptOrSummary,
      confidenceOverall: model.confidenceOverall,
    };
  }

  return {
    ok: true,
    action: outcome.plan.action,
    created: outcome.created.map((c) => ({
      id: c.id,
      patientName: c.patientName,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
    })),
    rescheduled: outcome.rescheduled.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      previousStartAt: r.previousStartAt.toISOString(),
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    })),
    cancelled: outcome.cancelled.map((c) => ({
      id: c.id,
      patientName: c.patientName,
      startAt: c.startAt.toISOString(),
    })),
    renamed: outcome.renamed.map((r) => ({
      id: r.id,
      previousName: r.previousName,
      patientName: r.patientName,
      startAt: r.startAt.toISOString(),
    })),
    noShows: outcome.noShows.map((n) => ({
      id: n.id,
      patientName: n.patientName,
      startAt: n.startAt.toISOString(),
      noShowReason: n.noShowReason,
    })),
    errors: outcome.errors,
    newPatientNames: outcome.newPatientNames,
    issues: outcome.issues.map((issue) => ({
      message: issue.message,
      suggestedSlots: issue.suggestedSlots?.map((s) => ({
        startAt: s.startUtc.toISOString(),
        endAt: s.endUtc.toISOString(),
        label: s.label,
      })),
    })),
    summary: model.transcriptOrSummary ?? null,
    confidenceOverall: model.confidenceOverall ?? null,
  };
}
