import "server-only";

import { FinancialTransactionKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EvolutionSessionConsumptionSummary } from "@/lib/finance/evolution-session-consumption";

export async function loadEvolutionSessionConsumptionSummary(
  sessionId: string,
): Promise<EvolutionSessionConsumptionSummary | null> {
  const session = await prisma.patientServiceSession.findFirst({
    where: { id: sessionId },
    select: {
      id: true,
      sequence: true,
      consumedAt: true,
      purchaseId: true,
      purchase: {
        select: {
          id: true,
          patientId: true,
          patient: { select: { name: true } },
          service: { select: { name: true } },
          sessions: { select: { id: true, status: true } },
          transactions: {
            where: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!session) return null;

  const sessionCount = session.purchase.sessions.length;
  const pendingRemaining = session.purchase.sessions.filter(
    (s) => s.status === "PENDING",
  ).length;

  return {
    consumed: true,
    sessionId: session.id,
    purchaseId: session.purchaseId,
    patientId: session.purchase.patientId,
    patientName: session.purchase.patient.name,
    serviceName: session.purchase.service.name,
    sequence: session.sequence,
    sessionCount,
    pendingRemaining,
    consumedAtIso: (session.consumedAt ?? new Date()).toISOString(),
    hasIncomePayment: session.purchase.transactions.length > 0,
  };
}
