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
} from "@/lib/evolution-hybrid";
import {
  canUseOfficeFinance,
  effectivePlanForFeatures,
  formatAudioLimitPhrase,
  getPlanLimits,
} from "@/lib/plan-limits";
import { OFFICE_FINANCE_PLAN_ERROR } from "@/lib/office-finance-access";
import { logger } from "@/lib/logger";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import type { EvolutionExamPayload } from "@/lib/evolution-hybrid";
import { runOfficeFinanceExtraction } from "@/lib/office-finance-ai-extract";
import { parseOfficeFinanceExtractTarget } from "@/lib/office-finance-extract-target";
import { sanitizeText } from "@/lib/sanitize";
import { getPatientAccessScope, PROFILE_REQUIRED_ERROR } from "@/lib/intra-user/patient-access";
import { scopedPatientWhereOrEmpty } from "@/lib/intra-user/patient-scope";
import {
  kickOfficeFinanceWorkerBestEffort,
  tryProcessQueuedOfficeFinanceJobInline,
} from "@/lib/office-finance-job-worker";

export const maxDuration = 300;

const FormSchema = z.object({
  audioDurationSec: z.coerce.number().int().min(0).max(36_000).optional().nullable(),
  text: z.string().trim().max(4000).optional(),
});

function payloadsToExtractFiles(payloads: EvolutionExamPayload[]): Array<{
  base64: string;
  mimeType: string;
  fileName: string;
}> {
  return payloads.map((p) => ({
    base64: p.base64,
    mimeType: p.mimeType,
    fileName: p.fileName,
  }));
}

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

    const rateLimitResult = await enforceAiBillingRateLimit({
      userKey: authUser.email.toLowerCase(),
      ip: getRequestClientIp(request.headers),
    });
    if (!rateLimitResult.allowed) {
      logger.warn("API office-finance/extract: rate limit", { feature: "office-finance" });
      return NextResponse.json(
        {
          success: false,
          error: aiBillingRateLimitMessage(rateLimitResult.resetIn),
        },
        { status: 429 },
      );
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }] },
      select: {
        id: true,
        plan: true,
        email: true,
        isInfluencer: true,
      },
    });
    if (!dbUser?.id) {
      return NextResponse.json(
        { success: false, error: "Usuário não encontrado na base da aplicação." },
        { status: 400 },
      );
    }

    if (!canUseOfficeFinance(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return NextResponse.json(
        { success: false, error: OFFICE_FINANCE_PLAN_ERROR },
        { status: 403 },
      );
    }

    const effectivePlan = effectivePlanForFeatures(dbUser.plan, dbUser.isInfluencer);
    const planAllowsAttachments = effectivePlan !== "BASICO";
    const limits = getPlanLimits(dbUser.plan, dbUser.email, dbUser.isInfluencer);

    const formData = await request.formData();
    const extractTarget = parseOfficeFinanceExtractTarget(formData.get("extractTarget"));
    const parsedForm = FormSchema.safeParse({
      audioDurationSec:
        typeof formData.get("audioDurationSec") === "string"
          ? formData.get("audioDurationSec")
          : typeof formData.get("audioDurationSec") === "number"
            ? formData.get("audioDurationSec")
            : undefined,
      text: typeof formData.get("text") === "string" ? formData.get("text") : undefined,
    });
    if (!parsedForm.success) {
      return NextResponse.json(
        { success: false, error: parsedForm.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    const audioDurationSec = parsedForm.data.audioDurationSec ?? null;
    const inputText = parsedForm.data.text ? sanitizeText(parsedForm.data.text) : null;

    const audioFile = formData.get("audio") as File | null;
    let audio:
      | {
          mimeType: string;
          base64: string;
        }
      | null = null;

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
          {
            success: false,
            error: `Tipo de áudio não permitido: ${audioFile.type || resolvedMime}`,
          },
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
            error:
              "Plano gratuito permite apenas áudio. Faça upgrade (Profissional ou Premium) para anexar fotos ou PDF.",
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

    if (!audio && imagePayloads.length === 0 && !inputText) {
      return NextResponse.json(
        { success: false, error: "Informe texto, grave um áudio ou envie um ficheiro (imagem/PDF)." },
        { status: 400 },
      );
    }

    const patientScope = await getPatientAccessScope();
    if (!patientScope || patientScope.denied || !patientScope.activeIntraUser) {
      return NextResponse.json(
        { success: false, error: PROFILE_REQUIRED_ERROR },
        { status: 403 },
      );
    }
    const patientWhere = scopedPatientWhereOrEmpty(dbUser.id, patientScope);

    const shouldEnqueueAsync =
      !!audio?.base64 &&
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: audioDurationSec ?? null,
        audioBytes: audioFile?.size ?? 0,
      });

    if (shouldEnqueueAsync) {
      const job = await prisma.officeFinanceExtractionJob.create({
        data: {
          userId: dbUser.id,
          status: "QUEUED",
          requestData: {
            audioBase64: audio!.base64,
            audioMimeForModel: audio!.mimeType,
            audioDurationSec: audioDurationSec ?? null,
            images: imagePayloads,
            extractTarget,
            text: inputText,
            activeIntraUserId: patientScope.activeIntraUser.id,
          },
        },
        select: { id: true, status: true, createdAt: true },
      });

      if (process.env.NODE_ENV === "development") {
        void tryProcessQueuedOfficeFinanceJobInline(job.id).catch((err: unknown) => {
          logger.error("API office-finance/extract: job inline em dev falhou", {
            feature: "office-finance/extract",
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      kickOfficeFinanceWorkerBestEffort();
      if (!process.env.CRON_SECRET?.trim()) {
        logger.warn(
          "API office-finance/extract: CRON_SECRET ausente — sem kick/cron eficaz.",
          { feature: "office-finance/extract" },
        );
      }

      return NextResponse.json(
        { async: true, jobId: job.id, status: job.status, createdAt: job.createdAt },
        { status: 202 },
      );
    }

    const [patientRows, serviceRows] = await Promise.all([
      prisma.patient.findMany({
        where: patientWhere,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.professionalService.findMany({
        where: { userId: dbUser.id, active: true },
        select: { id: true, name: true, defaultPriceCents: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    ]);

    const extractResult = await runOfficeFinanceExtraction({
      audio,
      text: inputText,
      images: payloadsToExtractFiles(imagePayloads),
      patients: patientRows,
      services: serviceRows,
      extractTarget,
    });

    if (!extractResult.ok) {
      logger.warn("office-finance extract falhou", { err: extractResult.error });
      return NextResponse.json({ success: false, error: extractResult.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      envelope: extractResult.envelope,
      limits: {
        maxAudioMinutes: limits.maxAudioMinutes,
        attachmentsAllowed: planAllowsAttachments,
      },
    });
  } catch (e) {
    const msg = formatAiProviderErrorForUser(e);
    logger.warn("office-finance extract exceção", {
      detail: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
