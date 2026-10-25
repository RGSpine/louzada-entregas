/** Polling do front quando POST /api/evolution devolve 202 + jobId. */

export const EVOLUTION_ASYNC_POLL_INTERVAL_MS = 3000;

export type EvolutionJobPollStatus =
  | { status: "SUCCEEDED"; result: unknown }
  | { status: "FAILED"; error: string }
  | { status: "QUEUED" | "PROCESSING"; createdAt?: string; startedAt?: string | null };

/** Timeout do cliente — o job pode continuar no servidor. */
export class EvolutionPollTimeoutError extends Error {
  readonly jobId: string;
  readonly waitedMin: number;

  constructor(jobId: string, waitedMin: number) {
    super(
      `O processamento no servidor ainda não terminou dentro do tempo máximo de espera deste navegador (~${waitedMin} min). O job pode continuar em segundo plano — use «Recuperar evolução» ou recarregue esta página.`,
    );
    this.name = "EvolutionPollTimeoutError";
    this.jobId = jobId;
    this.waitedMin = waitedMin;
  }
}

export function isEvolutionPollTimeoutError(err: unknown): err is EvolutionPollTimeoutError {
  return err instanceof EvolutionPollTimeoutError;
}

export async function fetchEvolutionJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<EvolutionJobPollStatus> {
  const statusResponse = await fetch(`/api/evolution/jobs/${jobId}`, {
    method: "GET",
    signal,
    cache: "no-store",
  });
  const statusData: Record<string, unknown> = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) {
    throw new Error(
      typeof statusData.error === "string"
        ? statusData.error
        : "Erro ao consultar job de áudio.",
    );
  }
  if (statusData.status === "SUCCEEDED") {
    if (statusData.result === undefined) {
      throw new Error(
        "Job concluído sem resultado disponível. Contacte o suporte com o horário da gravação.",
      );
    }
    return { status: "SUCCEEDED", result: statusData.result };
  }
  if (statusData.status === "FAILED") {
    return {
      status: "FAILED",
      error:
        typeof statusData.error === "string"
          ? statusData.error
          : "Falha no processamento assíncrono.",
    };
  }
  return {
    status: statusData.status === "PROCESSING" ? "PROCESSING" : "QUEUED",
    createdAt: typeof statusData.createdAt === "string" ? statusData.createdAt : undefined,
    startedAt:
      statusData.startedAt === null || typeof statusData.startedAt === "string"
        ? statusData.startedAt
        : undefined,
  };
}

function readPollMaxAttempts(): number {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_EVOLUTION_POLL_MAX_ATTEMPTS
      : undefined;
  if (raw?.trim()) {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n >= 50 && n <= 2000) return n;
  }
  return 400;
}

/**
 * Tentativas máximas antes de desistir no cliente (× intervalo ≈ tempo de espera).
 * Omisso 400×3s ≈ 20 min. Override: `NEXT_PUBLIC_EVOLUTION_POLL_MAX_ATTEMPTS` (50–2000).
 */
export const EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS = readPollMaxAttempts();

function pollDelayMs(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, EVOLUTION_ASYNC_POLL_INTERVAL_MS));
}

/**
 * Obtém o resultado final — uma ida ao servidor se já SUCCEEDED/FAILED; senão faz polling.
 */
export async function resolveEvolutionJobResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const first = await fetchEvolutionJobStatus(jobId, signal);
  if (first.status === "SUCCEEDED") {
    return first.result;
  }
  if (first.status === "FAILED") {
    throw new Error(first.error);
  }
  return pollEvolutionJobUntilDone(jobId, signal);
}

/**
 * Polling até SUCCEEDED/FAILED ou timeout do cliente.
 * Em `document.visibilityState === 'hidden'`, o intervalo pode ser alongado pelo OS.
 */
export async function pollEvolutionJobUntilDone(
  jobId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  for (let attempt = 0; attempt < EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const polled = await fetchEvolutionJobStatus(jobId, signal);
    if (polled.status === "SUCCEEDED") {
      return polled.result;
    }
    if (polled.status === "FAILED") {
      throw new Error(polled.error);
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      await pollDelayMs();
    } else {
      await pollDelayMs();
    }
  }
  const waitedMin = Math.round(
    (EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS * EVOLUTION_ASYNC_POLL_INTERVAL_MS) / 60_000,
  );
  throw new EvolutionPollTimeoutError(jobId, waitedMin);
}
