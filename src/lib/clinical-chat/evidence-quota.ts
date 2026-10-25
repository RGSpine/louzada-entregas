import { prisma } from "@/lib/prisma";
import {
  getClinicalChatEvidenceMonthlyLimit,
  isClinicalChatEvidenceQuotaUnlimited,
} from "@/lib/plan-limits";

export function startEndUtcMonth(d = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { start, end };
}

/** Respostas do assistente que dispararam busca externa no mês UTC (custa API mesmo sem citações). */
export async function countClinicalChatEvidenceSearchesThisMonth(
  userId: string,
): Promise<number> {
  const { start, end } = startEndUtcMonth();
  return prisma.patientChatMessage.count({
    where: {
      role: "assistant",
      session: { userId },
      createdAt: { gte: start, lte: end },
      metadata: {
        path: ["evidenceSearchAttempted"],
        equals: true,
      },
    },
  });
}

export type ClinicalChatEvidenceQuota = {
  usedThisMonth: number;
  limitThisMonth: number | null;
  remaining: number | null;
  unlimited: boolean;
};

export async function getClinicalChatEvidenceQuota(
  userId: string,
  email?: string | null,
  isInfluencer?: boolean,
): Promise<ClinicalChatEvidenceQuota> {
  const unlimited = isClinicalChatEvidenceQuotaUnlimited(email, isInfluencer);
  const used = await countClinicalChatEvidenceSearchesThisMonth(userId);
  const limit = unlimited ? null : getClinicalChatEvidenceMonthlyLimit();
  const remaining = limit !== null ? Math.max(0, limit - used) : null;
  return { usedThisMonth: used, limitThisMonth: limit, remaining, unlimited };
}

export async function canRunClinicalChatEvidenceSearch(
  userId: string,
  email?: string | null,
  isInfluencer?: boolean,
): Promise<boolean> {
  if (isClinicalChatEvidenceQuotaUnlimited(email, isInfluencer)) return true;
  const used = await countClinicalChatEvidenceSearchesThisMonth(userId);
  return used < getClinicalChatEvidenceMonthlyLimit();
}
