import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  resolveAudioMime,
} from "@/lib/evolution-hybrid";
import {
  runAgendaReport,
  type AgendaReportKind,
  classifyReportByKeywords,
} from "@/lib/agenda-reports";
import { extractAgendaReportKindFromAudio } from "@/lib/scheduling-report-ai-extract";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { canUseAgendaReports } from "@/lib/plan-limits";

export const maxDuration = 120;

const ReportFormSchema = z.object({
  mode: z.enum(["audio", "text"]),
  text: z.string().max(500).optional(),
});

function isRunnableKind(kind: AgendaReportKind): kind is Exclude<AgendaReportKind, "unknown"> {
  return kind !== "unknown";
}

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
    if (!canUseAgendaReports(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return NextResponse.json(
        { error: "Relatórios de agenda por voz estão disponíveis no plano PREMIUM. Faça upgrade para continuar." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const parsedForm = ReportFormSchema.safeParse({
      mode: formData.get("mode"),
      text: formData.get("text") ?? undefined,
    });
    if (!parsedForm.success) {
      return NextResponse.json(
        { error: parsedForm.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }

    const { mode, text } = parsedForm.data;
    let reportKind: AgendaReportKind = "unknown";
    let transcript: string | null = null;

    if (mode === "text") {
      const trimmed = (text ?? "").trim();
      if (!trimmed) {
        return NextResponse.json({ error: "Texto da pergunta vazio." }, { status: 400 });
      }
      reportKind = classifyReportByKeywords(trimmed) ?? "unknown";
      transcript = trimmed;
    } else {
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
      const extracted = await extractAgendaReportKindFromAudio({
        audioBase64: buf.toString("base64"),
        mimeType: mime,
      });
      if (!extracted.ok) {
        return NextResponse.json({ error: extracted.error }, { status: 502 });
      }
      reportKind = extracted.reportKind;
      transcript = extracted.transcript ?? null;
      if (reportKind === "unknown" && transcript) {
        const kw = classifyReportByKeywords(transcript);
        if (kw) reportKind = kw;
      }
    }

    if (!isRunnableKind(reportKind)) {
      return NextResponse.json({
        ok: false,
        reportKind,
        answer:
          "Não reconheci a pergunta. Ex.: quantos pacientes amanhã, quais os nomes, quantos atendi na última semana.",
        transcript,
      });
    }

    const answer = await runAgendaReport(dbUser.id, reportKind, DEFAULT_SCHEDULE_TIMEZONE);

    return NextResponse.json({
      ok: true,
      reportKind,
      answer,
      transcript,
    });
  } catch (err) {
    logger.error("API agenda/report falhou", { err });
    return NextResponse.json({ error: "Erro interno ao gerar relatório." }, { status: 500 });
  }
}
