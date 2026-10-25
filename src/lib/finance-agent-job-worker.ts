import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { kickEvolutionWorkerBestEffort } from "@/lib/evolution-job-worker";
import { runFinanceAgentRequest } from "@/lib/finance/run-finance-agent-request";

const StoredExamPayloadSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
});

export const FinanceAgentJobPayloadSchema = z.object({
  text: z.string().nullable().optional(),
  audioBase64: z.string().nullable().optional(),
  audioMimeForModel: z.string().nullable().optional(),
  audioDurationSec: z.number().nullable().optional(),
  images: z.array(StoredExamPayloadSchema),
  /** Fail-closed: ausente → false (sem relatório ADMIN). */
  allowPeriodReport: z.boolean().optional(),
  /** Escopo Intra User para filtrar pacientes no prompt. Ausente → lista vazia. */
  patientScope: z
    .object({
      isClinica: z.boolean(),
      activeIntraUser: z
        .object({
          id: z.string().min(1),
          name: z.string(),
          color: z.string(),
          role: z.enum(["ADMIN", "MEMBER"]),
          isOwner: z.boolean(),
          hasPin: z.boolean(),
          /** Jobs antigos sem o campo → liberado (compat). */
          canManagePatientServices: z.boolean().optional(),
        })
        .nullable(),
    })
    .optional(),
});

type StoredExamPayload = z.infer<typeof StoredExamPayloadSchema>;

export async function claimNextFinanceAgentJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH cte AS (
      SELECT id FROM "FinanceAgentJob"
      WHERE status = 'QUEUED'::"EvolutionProcessingJobStatus"
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "FinanceAgentJob" AS j
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
  await prisma.financeAgentJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    },
  });
}

async function finalizeSucceeded(jobId: string, data: Record<string, unknown>) {
  await prisma.financeAgentJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      resultData: data as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

export async function processFinanceAgentJobById(jobId: string): Promise<void> {
  const job = await prisma.financeAgentJob.findUnique({
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
        },
      },
    },
  });

  if (!job || job.status !== "PROCESSING") {
    return;
  }

  const parsed = FinanceAgentJobPayloadSchema.safeParse(job.requestData);
  if (!parsed.success) {
    await finalizeFailed(jobId, "Payload inválido do job do agente financeiro.");
    return;
  }
  const payload = parsed.data;

  try {
    const audio =
      payload.audioBase64?.trim() &&
      typeof payload.audioMimeForModel === "string" &&
      payload.audioMimeForModel.trim()
        ? {
            mimeType: payload.audioMimeForModel,
            base64: payload.audioBase64,
          }
        : null;

    const images = payload.images.map((p: StoredExamPayload) => ({
      mimeType: p.mimeType,
      base64: p.base64,
      fileName: p.fileName,
    }));

    const patientScope = payload.patientScope
      ? {
          isClinica: payload.patientScope.isClinica,
          activeIntraUser: payload.patientScope.activeIntraUser
            ? {
                ...payload.patientScope.activeIntraUser,
                canManagePatientServices:
                  payload.patientScope.activeIntraUser.role === "ADMIN"
                    ? true
                    : payload.patientScope.activeIntraUser.canManagePatientServices !==
                      false,
              }
            : null,
        }
      : undefined;

    const runResult = await runFinanceAgentRequest({
      professionalUserId: job.user.id,
      userPlan: job.user.plan,
      userEmail: job.user.email,
      isInfluencer: job.user.isInfluencer,
      typedText: payload.text?.trim() ?? "",
      audio,
      images,
      allowPeriodReport: payload.allowPeriodReport === true,
      patientScope,
    });

    if (!runResult.ok) {
      await finalizeFailed(jobId, runResult.error);
      return;
    }

    await finalizeSucceeded(jobId, {
      success: true,
      proposal: runResult.proposal,
      report: runResult.report,
      transcript: runResult.transcript,
      limits: runResult.limits,
    });
  } catch (err) {
    await finalizeFailed(
      jobId,
      err instanceof Error ? err.message : "Erro ao processar job do agente financeiro.",
    );
    logger.warn("finance-agent job erro", {
      feature: "finance-agent-job",
      jobId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Em `next dev`, processa este job logo após enqueue. */
export async function tryProcessQueuedFinanceAgentJobInline(jobId: string): Promise<void> {
  const claimed = await prisma.financeAgentJob.updateMany({
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
  await processFinanceAgentJobById(jobId);
}

/** Dispara o cron `/api/cron/evolution-jobs`, que processa evoluções e jobs financeiros. */
export function kickFinanceAgentWorkerBestEffort(): void {
  kickEvolutionWorkerBestEffort();
}
