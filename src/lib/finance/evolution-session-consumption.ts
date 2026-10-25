/**
 * Ponte Evolução → Serviços/Fiscal → Consultório Financeiro.
 * Tipos e textos — sem Prisma (usado também na UI da Nova Evolução).
 */

/** Aviso quando restam estas quantidades de sessões PENDING no plano. */
export const PACKAGE_NEAR_END_PENDING_COUNTS = [2, 1] as const;

export type EvolutionSessionConsumptionSummary = {
  consumed: boolean;
  reason?: string;
  sessionId?: string;
  purchaseId?: string;
  patientId?: string;
  patientName?: string;
  serviceName?: string;
  sequence?: number;
  sessionCount?: number;
  pendingRemaining?: number;
  consumedAtIso?: string;
  hasIncomePayment?: boolean;
};

/**
 * Plano em andamento com 1 ou 2 sessões restantes (não dispara no início do pacote).
 */
export function isPackageApproachingEnd(input: {
  pendingRemaining?: number | null;
  sessionCount?: number | null;
}): boolean {
  const pending = input.pendingRemaining;
  const total = input.sessionCount;
  if (pending == null || total == null) return false;
  if (pending < 1 || pending > 2) return false;
  if (total < 2) return false;
  const consumed = total - pending;
  return consumed >= 1;
}

export function formatPackageNearEndWarning(
  summary: Pick<
    EvolutionSessionConsumptionSummary,
    "pendingRemaining" | "sessionCount" | "serviceName" | "patientName"
  >,
): string | null {
  if (!isPackageApproachingEnd(summary)) return null;
  const pending = summary.pendingRemaining!;
  const service = summary.serviceName ? ` «${summary.serviceName}»` : "";
  const patient = summary.patientName ? `${summary.patientName}: ` : "";
  if (pending === 1) {
    return `${patient}última sessão restante do plano${service}. Considere renovar o tratamento.`;
  }
  return `${patient}faltam só 2 sessões para o fim do plano${service}. Bom momento para conversar sobre renovação.`;
}

export function formatEvolutionSessionConsumptionMessage(
  summary: EvolutionSessionConsumptionSummary,
): string | null {
  if (!summary.consumed || !summary.sequence || !summary.sessionCount) {
    return null;
  }
  const dateLabel = summary.consumedAtIso
    ? new Date(summary.consumedAtIso).toLocaleDateString("pt-BR")
    : null;
  const service = summary.serviceName ? ` de «${summary.serviceName}»` : "";
  const when = dateLabel ? ` em ${dateLabel}` : "";
  const nearEnd = formatPackageNearEndWarning(summary);
  const remaining = nearEnd
    ? ` ${nearEnd}`
    : summary.pendingRemaining != null
      ? ` Restam ${summary.pendingRemaining} pendente(s).`
      : "";
  return `Sessão ${summary.sequence} de ${summary.sessionCount}${service} marcada${when}.${remaining}`;
}

export function formatEvolutionFinanceFollowUp(
  summary: EvolutionSessionConsumptionSummary,
): string | null {
  if (!summary.consumed) return null;
  if (summary.hasIncomePayment) {
    return "Plano já pago no Consultório Financeiro — a baixa aparece em Serviços/Fiscal.";
  }
  return "Pagamento do plano ainda pendente no caixa. Registre a entrada no Consultório Financeiro ou em Serviços/Fiscal.";
}
