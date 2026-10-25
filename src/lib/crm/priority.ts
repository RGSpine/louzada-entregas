import type { CrmChurnRisk } from "@prisma/client";

const CHURN_WEIGHT: Record<CrmChurnRisk | string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Prioridade operacional = risco × MRR (centavos).
 * Cancelamento agendado e falha de pagamento elevam o peso.
 * Usado para ordenar a lista do CRM (revenue-weighted, estilo ChurnGuard).
 */
export function computeRetentionPriorityScore(input: {
  churnRisk: CrmChurnRisk | string;
  mrrCents: number;
  cancelScheduled?: boolean;
  paymentFailed?: boolean;
}): number {
  let weight = CHURN_WEIGHT[input.churnRisk] ?? 1;
  if (input.cancelScheduled) weight = Math.max(weight, 4);
  if (input.paymentFailed) weight = Math.max(weight, 4);
  const mrr = Math.max(0, input.mrrCents);
  return weight * mrr;
}
