import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  MAX_EXAM_BYTES,
  MAX_EXAM_FILES,
  normalizeExamFiles,
  resolveAudioMime,
  shouldUseAsyncAudioMode,
  type EvolutionExamPayload,
} from "@/lib/evolution-hybrid";
import {
  canUseOfficeFinance,
  effectivePlanForFeatures,
  formatAudioLimitPhrase,
  getPlanLimits,
} from "@/lib/plan-limits";
import { OFFICE_FINANCE_PLAN_ERROR } from "@/lib/office-finance-access";
import { canAccessFinanceAdminAreas } from "@/lib/finance/finance-rbac";
import { getIntraUserContext } from "@/lib/intra-user/context";
import { getPatientAccessScope, PROFILE_REQUIRED_ERROR } from "@/lib/intra-user/patient-access";
import { logger } from "@/lib/logger";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import { runFinanceAgentRequest } from "@/lib/finance/run-finance-agent-request";
import {
  kickFinanceAgentWorkerBestEffort,
  tryProcessQueuedFinanceAgentJobInline,
} from "@/lib/finance-agent-job-worker";

export const maxDuration = 300;

const FormSchema = z.object({
  text: z.string().max(4000).optional().nullable(),
  audioDurationSec: z.coerce.number().int().min(0).max(36_000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return NextResponse.json(
        { success: false, error: "Não autenticado. Faça login para continuar." },
        { status: 401 },
      );
    }

    const rl = await enforceAiBillingRateLimit({
      userKey: authUser.email.toLowerCase(),
      ip: getRequestClientIp(request.headers),
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: aiBillingRateLimitMessage(rl.resetIn) },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }] },
      select: { id: true, plan: true, email: true, isInfluencer: true },
    });
    if (!dbUser?.id) {
      return NextResponse.json(
        { success: false, error: "Usuário não encontrado na base da aplicação." },
        { status: 400 },
      );
    }
    if (!canUseOfficeFinance(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return NextResponse.json(
        {
          success: false,
          error: OFFICE_FINANCE_PLAN_ERROR,
        },
        { status: 403 },
      );
    }

    const allowPeriodReport = await canAccessFinanceAdminAreas();
    const patientAccessScope = await getPatientAccessScope();
    if (
      !patientAccessScope ||
      patientAccessScope.denied ||
      !patientAccessScope.activeIntraUser
    ) {
      return NextResponse.json(
        { success: false, error: PROFILE_REQUIRED_ERROR },
        { status: 403 },
      );
    }
    const intraCtx = await getIntraUserContext();
    const patientScope = {
      isClinica: intraCtx?.isClinica ?? false,
      activeIntraUser: patientAccessScope.activeIntraUser,
    };

    const effectivePlan = effectivePlanForFeatures(dbUser.plan, dbUser.isInfluencer);
    const planAllowsAttachments = effectivePlan !== "BASICO";
    const limits = getPlanLimits(dbUser.plan, dbUser.email, dbUser.isInfluencer);

    const formData = await request.formData();
    const parsedForm = FormSchema.safeParse({
      text: typeof formData.get("text") === "string" ? formData.get("text") : undefined,
      audioDurationSec:
        typeof formData.get("audioDurationSec") === "string"
          ? formData.get("audioDurationSec")
          : undefined,
    });
    if (!parsedForm.success) {
      return NextResponse.json(
        { success: false, error: parsedForm.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    const typedText = parsedForm.data.text?.trim() ?? "";
    const audioDurationSec = parsedForm.data.audioDurationSec ?? null;

    const audioFile = formData.get("audio") as File | null;
    let audio: { mimeType: string; base64: string } | null = null;
    if (audioFile && audioFile.size > 0) {
      if (audioFile.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { success: false, error: "Arquivo de áudio excede o limite máximo permitido." },
          { status: 400 },
        );
      }
      const resolvedMime = resolveAudioMime(audioFile);
      if (!ALLOWED_AUDIO_MIME.has(resolvedMime)) {
        return NextResponse.json(
          { success: false, error: `Tipo de áudio não permitido: ${audioFile.type || resolvedMime}` },
          { status: 400 },
        );
      }
      const maxSec = limits.maxAudioMinutes * 60;
      if (
        audioDurationSec != null &&
        Number.isFinite(audioDurationSec) &&
        audioDurationSec > maxSec + 5
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Gravação excede o limite do seu plano (${formatAudioLimitPhrase(limits.maxAudioMinutes)} por envio).`,
          },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await audioFile.arrayBuffer());
      audio = { mimeType: resolvedMime, base64: buffer.toString("base64") };
    }

    const imageRaw = formData.getAll("imageFiles") as File[];
    if (imageRaw.length > MAX_EXAM_FILES) {
      return NextResponse.json(
        { success: false, error: `Máximo de ${MAX_EXAM_FILES} anexos por pedido.` },
        { status: 400 },
      );
    }
    let imagePayloads: EvolutionExamPayload[] = [];
    if (imageRaw.some((f) => f.size > 0)) {
      if (!planAllowsAttachments) {
        return NextResponse.json(
          {
            success: false,
            error: "Plano gratuito permite apenas áudio/texto. Faça upgrade para anexar fotos ou PDF.",
          },
          { status: 403 },
        );
      }
      const files = imageRaw.filter((f) => f.size > 0);
      for (const f of files) {
        if (f.size > MAX_EXAM_BYTES) {
          return NextResponse.json(
            { success: false, error: `Ficheiro "${f.name}" excede o limite de tamanho por anexo.` },
            { status: 400 },
          );
        }
      }
      imagePayloads = await normalizeExamFiles(files);
    }

    if (!typedText && !audio && imagePayloads.length === 0) {
      return NextResponse.json(
        { success: false, error: "Envie um texto, áudio ou comprovante para o agente." },
        { status: 400 },
      );
    }

    const shouldEnqueueAsync =
      !!audio?.base64 &&
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: audioDurationSec ?? null,
        audioBytes: audioFile?.size ?? 0,
      });

    if (shouldEnqueueAsync) {
      const job = await prisma.financeAgentJob.create({
        data: {
          userId: dbUser.id,
          status: "QUEUED",
          requestData: {
            text: typedText || null,
            audioBase64: audio!.base64,
            audioMimeForModel: audio!.mimeType,
            audioDurationSec: audioDurationSec ?? null,
            images: imagePayloads,
            allowPeriodReport,
            patientScope,
          },
        },
        select: { id: true, status: true, createdAt: true },
      });

      if (process.env.NODE_ENV === "development") {
        void tryProcessQueuedFinanceAgentJobInline(job.id).catch((err: unknown) => {
          logger.error("API finance-agent: job inline em dev falhou", {
            feature: "finance-agent",
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      kickFinanceAgentWorkerBestEffort();
      if (!process.env.CRON_SECRET?.trim()) {
        logger.warn("API finance-agent: CRON_SECRET ausente — sem kick/cron eficaz.", {
          feature: "finance-agent",
        });
      }

      return NextResponse.json(
        { async: true, jobId: job.id, status: job.status, createdAt: job.createdAt },
        { status: 202 },
      );
    }

    const runResult = await runFinanceAgentRequest({
      professionalUserId: dbUser.id,
      userPlan: dbUser.plan,
      userEmail: dbUser.email,
      isInfluencer: dbUser.isInfluencer,
      typedText,
      audio,
      images: imagePayloads.map((p) => ({
        mimeType: p.mimeType,
        base64: p.base64,
        fileName: p.fileName,
      })),
      allowPeriodReport,
      patientScope,
    });

    if (!runResult.ok) {
      return NextResponse.json({ success: false, error: runResult.error }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      proposal: runResult.proposal,
      report: runResult.report,
      transcript: runResult.transcript,
      limits: runResult.limits,
    });
  } catch (e) {
    const msg = formatAiProviderErrorForUser(e);
    logger.warn("finance-agent exceção", { detail: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
