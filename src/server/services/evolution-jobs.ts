import { prisma } from "@/lib/prisma";
import { RouteJobIdSchema } from "@/lib/api-schemas";

export type EvolutionJobStatusPayload =
  | {
      status: "SUCCEEDED";
      result: unknown;
      finishedAt: Date | null;
    }
  | {
      status: "FAILED";
      error: string;
      finishedAt: Date | null;
    }
  | {
      status: "QUEUED" | "PROCESSING";
      startedAt: Date | null;
      createdAt: Date;
    };

export type GetEvolutionJobResult =
  | { ok: true; payload: EvolutionJobStatusPayload; jobId: string; createdAt: Date }
  | { ok: false; reason: "invalid_id" | "not_found"; message: string };

export type RecoverableEvolutionJobSummary = {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED";
  createdAt: string;
  finishedAt: string | null;
  /** Resumo curto para a mensagem do dashboard. */
  patientHint: string | null;
  audioDurationSec: number | null;
};

const RECOVERABLE_SUCCEEDED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RECOVERABLE_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Jobs recentes que o utilizador pode recuperar no dashboard (QUEUED, PROCESSING ou SUCCEEDED). */
export async function listRecoverableEvolutionJobsForUser(
  userId: string,
): Promise<RecoverableEvolutionJobSummary[]> {
  const listCutoff = new Date(Date.now() - RECOVERABLE_LIST_MAX_AGE_MS);
  const succeededCutoff = new Date(Date.now() - RECOVERABLE_SUCCEEDED_MAX_AGE_MS);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      status: string;
      created_at: Date;
      finished_at: Date | null;
      patient_hint: string | null;
      audio_duration_sec: number | null;
    }>
  >`
    SELECT
      j.id,
      j.status::text AS status,
      j.created_at,
      j.finished_at,
      j.result_data->>'nome' AS patient_hint,
      NULLIF(j.request_data->>'audioDurationSec', '')::int AS audio_duration_sec
    FROM "EvolutionProcessingJob" j
    WHERE j.user_id = ${userId}
      AND j.created_at >= ${listCutoff}
      AND (
        j.status IN ('QUEUED'::"EvolutionProcessingJobStatus", 'PROCESSING'::"EvolutionProcessingJobStatus")
        OR (
          j.status = 'SUCCEEDED'::"EvolutionProcessingJobStatus"
          AND j.finished_at >= ${succeededCutoff}
          AND j.result_data IS NOT NULL
        )
      )
    ORDER BY j.created_at DESC
    LIMIT 5
  `;

  return rows.map((row) => ({
    jobId: row.id,
    status: row.status as RecoverableEvolutionJobSummary["status"],
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    patientHint:
      typeof row.patient_hint === "string" && row.patient_hint.trim().length > 0
        ? row.patient_hint.trim()
        : null,
    audioDurationSec:
      typeof row.audio_duration_sec === "number" && Number.isFinite(row.audio_duration_sec)
        ? row.audio_duration_sec
        : null,
  }));
}

/** Consulta job de evolução com isolamento por userId (LGPD). */
export async function getEvolutionJobForUser(
  jobId: string,
  userId: string,
): Promise<GetEvolutionJobResult> {
  const paramsParsed = RouteJobIdSchema.safeParse({ jobId });
  if (!paramsParsed.success) {
    return { ok: false, reason: "invalid_id", message: "ID de job inválido." };
  }

  const row = await prisma.evolutionProcessingJob.findFirst({
    where: { id: paramsParsed.data.jobId, userId },
    select: {
      status: true,
      resultData: true,
      errorMessage: true,
      finishedAt: true,
      startedAt: true,
      createdAt: true,
    },
  });

  if (!row) {
    return { ok: false, reason: "not_found", message: "Job não encontrado." };
  }

  if (row.status === "SUCCEEDED") {
    return {
      ok: true,
      jobId: paramsParsed.data.jobId,
      createdAt: row.createdAt,
      payload: {
        status: row.status,
        result: row.resultData,
        finishedAt: row.finishedAt,
      },
    };
  }

  if (row.status === "FAILED") {
    return {
      ok: true,
      jobId: paramsParsed.data.jobId,
      createdAt: row.createdAt,
      payload: {
        status: row.status,
        error: row.errorMessage || "Falha ao processar áudio.",
        finishedAt: row.finishedAt,
      },
    };
  }

  return {
    ok: true,
    jobId: paramsParsed.data.jobId,
    createdAt: row.createdAt,
    payload: {
      status: row.status,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
    },
  };
}
