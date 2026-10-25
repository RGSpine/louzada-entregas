import {
  EVOLUTION_ASYNC_POLL_INTERVAL_MS,
  EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS,
} from "@/lib/evolution-async-client";

/**
 * Polling quando `POST /api/finance-agent` devolve **202** + jobId (áudio longo).
 */
export async function pollFinanceAgentUntilDone(jobId: string): Promise<unknown> {
  for (let attempt = 0; attempt < EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS; attempt++) {
    const statusResponse = await fetch(`/api/finance-agent/jobs/${jobId}`, {
      method: "GET",
    });
    const statusData: Record<string, unknown> = await statusResponse.json().catch(() => ({}));

    if (!statusResponse.ok) {
      throw new Error(
        typeof statusData.error === "string" ? statusData.error : "Erro ao consultar job do agente.",
      );
    }

    if (statusData.status === "SUCCEEDED" && statusData.result !== undefined) {
      return statusData.result;
    }

    if (statusData.status === "FAILED") {
      throw new Error(
        typeof statusData.error === "string"
          ? statusData.error
          : "Falha no processamento do agente financeiro.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, EVOLUTION_ASYNC_POLL_INTERVAL_MS));
  }

  const waitedMin = Math.round(
    (EVOLUTION_ASYNC_POLL_MAX_ATTEMPTS * EVOLUTION_ASYNC_POLL_INTERVAL_MS) / 60_000,
  );

  throw new Error(
    `O agente ainda não terminou dentro do tempo de espera do navegador (~${waitedMin} min). Pode estar a decorrer em segundo plano.`,
  );
}
