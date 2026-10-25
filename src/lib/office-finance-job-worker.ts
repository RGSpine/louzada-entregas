import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { kickEvolutionWorkerBestEffort } from "@/lib/evolution-job-worker";
import {
  runOfficeFinanceExtraction,
} from "@/lib/office-finance-ai-extract";
import { parseOfficeFinanceExtractTarget } from "@/lib/office-finance-extract-target";
import { effectivePlanForFeatures, getPlanLimits } from "@/lib/plan-limits";
import { buildPatientScopeWhere } from "@/lib/intra-user/patient-scope";

/**
 * Payload guardado na fila (sem pacientes/catálogo — redesenhamos na execução do worker).
 * `images` já normalizados (base64+mime+ficheiro).
 */
const StoredExamPayloadSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
});

export const OfficeFinanceJobPayloadSchema = z.object({
  audioBase64: z.string().nullable().optional(),
  audioMimeForModel: z.string().nullable().optional(),
  audioDurationSec: z.number().nullable().optional(),
  images: z.array(StoredExamPayloadSchema),
  extractTarget: z.string().optional(),
  text: z.string().max(4000).nullable().optional(),
  activeIntraUserId: z.string().min(1),
});

type StoredExamPayload = z.infer<typeof StoredExamPayloadSchema>;

function examPayloadToExtractFiles(images: StoredExamPayload[]) {
  return images.map((p) => ({
    base64: p.base64,
    mimeType: p.mimeType,
    fileName: p.fileName,
  }));
}

export async function claimNextOfficeFinanceExtractionJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH cte AS (
      SELECT id FROM "OfficeFinanceExtractionJob"
      WHERE status = 'QUEUED'::"EvolutionProcessingJobStatus"
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OfficeFinanceExtractionJob" AS j
    SET
      status = 'PROCESSING'::"EvolutionProcessingJobStatus",
      started_at = NOW(),
      updated_at = NOW(),
      error_message = NULL
    FROM cte
    WHERE j.id = cte.id
    RETURNING j.id;
  `;
  return rows[0]?.id ?? null;
}

async function finalizeFailed(jobId: string, message: string) {
  await prisma.officeFinanceExtractionJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    },
  });
}

async function finalizeSucceeded(jobId: string, data: Record<string, unknown>) {
  await prisma.officeFinanceExtractionJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      resultData: data as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

export async function processOfficeFinanceJobById(jobId: string): Promise<void> {
  const job = await prisma.officeFinanceExtractionJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      requestData: true,
      user: {
        select: {
          id: true,
          plan: true,
          email: true,
          isInfluencer: true,
          authUserId: true,
        },
      },
    },
  });

  if (!job || job.status !== "PROCESSING") {
    return;
  }

  const parsed = OfficeFinanceJobPayloadSchema.safeParse(job.requestData);
  if (!parsed.success) {
    await finalizeFailed(jobId, "Payload inválido do job financeiro.");
    return;
  }
  const payload = parsed.data;

  const userId = job.user.id;

  try {
    const activeIntraUser = await prisma.intraUser.findFirst({
      where: { id: payload.activeIntraUserId, userId },
      select: {
        id: true,
        name: true,
        color: true,
        role: true,
        isOwner: true,
        pinHash: true,
        canManagePatientServices: true,
      },
    });
    if (!activeIntraUser) {
      await finalizeFailed(jobId, "Perfil profissional inválido para este processamento.");
      return;
    }
    const patientWhere = buildPatientScopeWhere({
      tenantId: userId,
      activeIntraUser: {
        id: activeIntraUser.id,
        name: activeIntraUser.name,
        color: activeIntraUser.color,
        role: activeIntraUser.role,
        isOwner: activeIntraUser.isOwner,
        hasPin: activeIntraUser.role === "ADMIN" && Boolean(activeIntraUser.pinHash),
        canManagePatientServices:
          activeIntraUser.role === "ADMIN"
            ? true
            : activeIntraUser.canManagePatientServices !== false,
      },
    });

    const [patientRows, serviceRows] = await Promise.all([
      prisma.patient.findMany({
        where: patientWhere,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.professionalService.findMany({
        where: { userId, active: true },
        select: { id: true, name: true, defaultPriceCents: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    ]);

    const audio =
      payload.audioBase64?.trim() &&
      typeof payload.audioMimeForModel === "string" &&
      payload.audioMimeForModel.trim()
        ? {
            mimeType: payload.audioMimeForModel,
            base64: payload.audioBase64,
          }
        : null;

    const limits = getPlanLimits(job.user.plan, job.user.email, job.user.isInfluencer);
    const effectivePlan = effectivePlanForFeatures(job.user.plan, job.user.isInfluencer);

    const extractResult = await runOfficeFinanceExtraction({
      audio,
      text: payload.text ?? null,
      images: examPayloadToExtractFiles(payload.images),
      patients: patientRows,
      services: serviceRows,
      extractTarget: parseOfficeFinanceExtractTarget(payload.extractTarget),
    });

    if (!extractResult.ok) {
      await finalizeFailed(jobId, extractResult.error);
      return;
    }

    await finalizeSucceeded(jobId, {
      success: true,
      envelope: extractResult.envelope,
      limits: {
        maxAudioMinutes: limits.maxAudioMinutes,
        attachmentsAllowed: effectivePlan !== "BASICO",
      },
    });
  } catch (err) {
    await finalizeFailed(
      jobId,
      err instanceof Error ? err.message : "Erro ao processar job financeiro.",
    );
    logger.warn("office-finance job erro", {
      feature: "office-finance-job",
      jobId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Em `next dev`, processa este job logo após enqueue (evita ficar só em QUEUED sem CRON configurado).
 */
export async function tryProcessQueuedOfficeFinanceJobInline(jobId: string): Promise<void> {
  const claimed = await prisma.officeFinanceExtractionJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      errorMessage: null,
    },
  });
  if (claimed.count === 0) {
    return;
  }
  await processOfficeFinanceJobById(jobId);
}

/** Dispara o mesmo cron `/api/cron/evolution-jobs`, que já processa evoluções e jobs financeiros. */
export function kickOfficeFinanceWorkerBestEffort(): void {
  kickEvolutionWorkerBestEffort();
}
