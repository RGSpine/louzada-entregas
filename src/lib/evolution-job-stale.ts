import { prisma } from "@/lib/prisma";
import { getEvolutionJobStaleAfterMinutes } from "@/lib/evolution-cron-limits";

const STALE_FAILURE_MESSAGE =
  "Processamento interrompido ou excedeu o tempo máximo no servidor. Tente novamente; se o áudio for muito longo, considere dividir em partes.";

/**
 * Jobs de extração financeira (IA): PROCESSING obsoletos → FAILED.
 *
 * @returns número de linhas atualizadas
 */
export async function failStaleOfficeFinanceExtractionJobs(): Promise<number> {
  const staleMinutes = getEvolutionJobStaleAfterMinutes();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const result = await prisma.officeFinanceExtractionJob.updateMany({
    where: {
      status: "PROCESSING",
      OR: [
        { startedAt: { lt: cutoff } },
        { startedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: STALE_FAILURE_MESSAGE,
      finishedAt: new Date(),
    },
  });

  return result.count;
}

/**
 * Jobs do Agente Financeiro: PROCESSING obsoletos → FAILED.
 */
export async function failStaleFinanceAgentJobs(): Promise<number> {
  const staleMinutes = getEvolutionJobStaleAfterMinutes();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const result = await prisma.financeAgentJob.updateMany({
    where: {
      status: "PROCESSING",
      OR: [
        { startedAt: { lt: cutoff } },
        { startedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: STALE_FAILURE_MESSAGE,
      finishedAt: new Date(),
    },
  });

  return result.count;
}

/**
 * Marca como FAILED jobs da Nova Evolução que ficaram em PROCESSING além do limiar.
 *
 * @returns número de linhas atualizadas
 */
export async function failStaleEvolutionProcessingJobs(): Promise<number> {
  const staleMinutes = getEvolutionJobStaleAfterMinutes();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const result = await prisma.evolutionProcessingJob.updateMany({
    where: {
      status: "PROCESSING",
      OR: [
        { startedAt: { lt: cutoff } },
        { startedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: STALE_FAILURE_MESSAGE,
      finishedAt: new Date(),
    },
  });

  return result.count;
}
