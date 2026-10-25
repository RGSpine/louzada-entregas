import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  type EvolutionAsyncRequestPayload,
  runEvolutionFromPayload,
} from "@/lib/evolution-hybrid";

export const EvolutionJobPayloadSchema = z
  .object({
    mergeMode: z.boolean(),
    existingContent: z.string().optional(),
    clinicalContinuation: z.boolean().optional().default(false),
    audioBase64: z.string().nullable(),
    audioStoragePath: z.string().max(300).optional().nullable(),
    audioMimeForModel: z.string().nullable(),
    audioDurationSec: z.number().int().min(0).optional().nullable(),
    examFiles: z.array(
      z.object({
        base64: z.string(),
        mimeType: z.string(),
        fileName: z.string(),
      }),
    ),
  })
  .refine(
    (p) => !(p.audioStoragePath?.trim() && p.audioBase64),
    { message: "Job não pode ter audioStoragePath e audioBase64 simultaneamente." },
  );

/**
 * Claim atómico do próximo job QUEUED (Postgres SKIP LOCKED).
 * Evita dois workers processarem o mesmo job.
 */
export async function claimNextEvolutionProcessingJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH cte AS (
      SELECT id FROM "EvolutionProcessingJob"
      WHERE status = 'QUEUED'::"EvolutionProcessingJobStatus"
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EvolutionProcessingJob" AS j
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

export async function processEvolutionJobById(jobId: string): Promise<void> {
  const job = await prisma.evolutionProcessingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      requestData: true,
      userId: true,
      user: { select: { authUserId: true, email: true } },
    },
  });

  if (!job || job.status !== "PROCESSING") {
    return;
  }

  const parsedPayload = EvolutionJobPayloadSchema.safeParse(job.requestData);
  if (!parsedPayload.success) {
    await prisma.evolutionProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: "Payload inválido do job.",
        finishedAt: new Date(),
      },
    });
    return;
  }

  const authUserId = job.user.authUserId?.trim();
  if (!authUserId) {
    await prisma.evolutionProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage:
          "Conta sem vínculo com Supabase Auth. Contacte o suporte ou faça login novamente.",
        finishedAt: new Date(),
      },
    });
    return;
  }

  const payload = parsedPayload.data as EvolutionAsyncRequestPayload;

  try {
    const result = await runEvolutionFromPayload(
      { id: authUserId, email: job.user.email ?? "" },
      payload,
      job.userId,
    );

    if ("error" in result) {
      await prisma.evolutionProcessingJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: result.error,
          finishedAt: new Date(),
        },
      });
      return;
    }

    await prisma.evolutionProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        resultData: result as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.evolutionProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage:
          err instanceof Error ? err.message : "Erro inesperado ao processar job.",
        finishedAt: new Date(),
      },
    });
  }
}

/**
 * Em `next dev`, processa este job sem HTTP (evita falhas de `fetch` loopback / concorrência).
 * Em produção use kick + cron; não await isto no handler — em serverless o isolate pode terminar após o 202.
 */
export async function tryProcessQueuedEvolutionJobInline(
  jobId: string,
): Promise<void> {
  const claimed = await prisma.evolutionProcessingJob.updateMany({
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
  await processEvolutionJobById(jobId);
}

/**
 * Dispara o worker assim que um job é enfileirado (latência normal em produção).
 * Com Vercel Hobby o cron em `vercel.json` é no máximo 1×/dia; sem kick fiel, jobs
 * podem esperar até à próxima janela do cron.
 */
export function kickEvolutionWorkerBestEffort(): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    logger.warn("kickEvolutionWorkerBestEffort: CRON_SECRET ausente — worker HTTP não disparado", {
      feature: "evolution-job-worker",
    });
    return;
  }

  let origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "";
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (!origin && vercelUrl) {
    origin = `https://${vercelUrl}`;
  }
  /** Sem URL pública o kick não corria em `npm run dev` → jobs ficavam QUEUED indefinidamente. */
  if (!origin && process.env.NODE_ENV === "development") {
    const port = process.env.PORT?.trim() || "3000";
    origin = `http://127.0.0.1:${port}`;
  }
  if (!origin) {
    logger.warn("kickEvolutionWorkerBestEffort: origem indisponível (NEXT_PUBLIC_APP_URL / VERCEL_URL)", {
      feature: "evolution-job-worker",
    });
    return;
  }

  void fetch(`${origin}/api/cron/evolution-jobs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  }).catch((err: unknown) => {
    logger.warn("kickEvolutionWorkerBestEffort: fetch ao cron falhou", {
      feature: "evolution-job-worker",
      origin,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

const staleKickLastAt = new Map<string, number>();

/**
 * Se o job continua QUEUED além do limiar, re-dispara o worker (debounce 60s por job).
 */
export function maybeKickStaleQueuedEvolutionJob(
  jobId: string,
  status: string,
  createdAt: Date,
): void {
  if (status !== "QUEUED") return;
  const ageMs = Date.now() - createdAt.getTime();
  if (ageMs < 30_000) return;
  const last = staleKickLastAt.get(jobId) ?? 0;
  if (Date.now() - last < 60_000) return;
  staleKickLastAt.set(jobId, Date.now());
  logger.info("maybeKickStaleQueuedEvolutionJob: re-kick worker", {
    feature: "evolution-job-worker",
    jobId,
    ageSec: Math.round(ageMs / 1000),
  });
  kickEvolutionWorkerBestEffort();
}

/**
 * Após responder 202 ao cliente, processa o job inline (Fluid Compute / `after`)
 * e mantém kick HTTP como reserva.
 */
export function scheduleEvolutionJobProcessing(jobId: string): void {
  kickEvolutionWorkerBestEffort();
  after(async () => {
    try {
      await tryProcessQueuedEvolutionJobInline(jobId);
    } catch (err) {
      logger.warn("scheduleEvolutionJobProcessing: inline falhou; kick de reserva", {
        feature: "evolution-job-worker",
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      kickEvolutionWorkerBestEffort();
    }
  });
}
