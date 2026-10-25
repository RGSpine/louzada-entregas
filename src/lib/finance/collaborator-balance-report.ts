/**
 * Relatório de balanço dos colaboradores — server-only.
 * Nunca exportar como Server Action; o caller garante ADMIN + isClinica.
 */
import "server-only";

import {
  CollaboratorPayoutPeriod,
  ExpenseNature,
  FinancialEntrySource,
  FinancialTransactionKind,
  FinancialTransactionMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  buildCollaboratorBalanceLine,
  commissionCentsFromBase,
  resolveCollaboratorPeriod,
  type CollaboratorAttendanceDetail,
  type CollaboratorBalanceLine,
  type CollaboratorPayoutHistoryItem,
  type CollaboratorPayoutPreset,
  type ResolvedCollaboratorPeriod,
} from "@/lib/finance/collaborator-balance";

export type CollaboratorBalanceReport = {
  period: ResolvedCollaboratorPeriod;
  lines: CollaboratorBalanceLine[];
  totals: {
    /** Receita bruta do caixa no período (INCOME não estornada). */
    grossIncomeCents: number;
    baseCents: number;
    commissionDueCents: number;
    paidCents: number;
    balanceCents: number;
    attendanceCount: number;
    /** Sessões sem Intra User atribuído. */
    unassignedAttendanceCount: number;
  };
};

function resolveAttendingId(row: {
  evolution: { attendingIntraUserId: string | null } | null;
  appointment: { intraUserId: string | null } | null;
}): string | null {
  return (
    row.evolution?.attendingIntraUserId ??
    row.appointment?.intraUserId ??
    null
  );
}

export async function getCollaboratorBalanceReportForUser(
  professionalUserId: string,
  input: {
    preset: CollaboratorPayoutPreset;
    offset?: number;
    anchorIso?: string | null;
  },
): Promise<CollaboratorBalanceReport> {
  const period = resolveCollaboratorPeriod({
    preset: input.preset,
    offset: input.offset ?? 0,
    anchorIso: input.anchorIso ?? null,
  });

  const [members, consumptions, payouts, incomeAgg] = await Promise.all([
    prisma.intraUser.findMany({
      where: { userId: professionalUserId },
      orderBy: [{ isOwner: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        role: true,
        commissionRateBps: true,
      },
    }),
    prisma.sessionConsumptionEvent.findMany({
      where: {
        professionalUserId,
        consumedAtAnchor: { gte: period.startUtc, lt: period.endUtc },
      },
      orderBy: { consumedAtAnchor: "desc" },
      select: {
        id: true,
        consumedAtAnchor: true,
        patientId: true,
        evolution: { select: { attendingIntraUserId: true } },
        appointment: { select: { intraUserId: true } },
        session: {
          select: {
            allocatedPriceCents: true,
            purchase: {
              select: {
                service: { select: { name: true } },
                patient: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.collaboratorPayout.findMany({
      where: {
        professionalUserId,
        periodKey: period.periodKey,
        voidedAt: null,
      },
      orderBy: { paidAt: "desc" },
      select: {
        id: true,
        intraUserId: true,
        amountCents: true,
        paidAt: true,
        notes: true,
        financialTransactionId: true,
        transaction: { select: { method: true } },
      },
    }),
    prisma.financialTransaction.aggregate({
      where: {
        professionalUserId,
        kind: FinancialTransactionKind.INCOME,
        voidedAt: null,
        occurredAt: { gte: period.startUtc, lt: period.endUtc },
      },
      _sum: { amountCents: true },
    }),
  ]);

  const memberIds = new Set(members.map((m) => m.id));
  const attendancesByUser = new Map<string, CollaboratorAttendanceDetail[]>();
  const baseByUser = new Map<string, { count: number; base: number }>();
  let unassignedAttendanceCount = 0;

  for (const c of consumptions) {
    const uid = resolveAttendingId(c);
    const value = Math.max(0, c.session.allocatedPriceCents);
    if (!uid || !memberIds.has(uid)) {
      unassignedAttendanceCount += 1;
      continue;
    }
    const detail: CollaboratorAttendanceDetail = {
      consumptionId: c.id,
      patientId: c.session.purchase.patient.id,
      patientName: c.session.purchase.patient.name,
      attendanceDateIso: c.consumedAtAnchor.toISOString(),
      sessionValueCents: value,
      serviceName: c.session.purchase.service?.name ?? null,
    };
    const list = attendancesByUser.get(uid) ?? [];
    list.push(detail);
    attendancesByUser.set(uid, list);
    const cur = baseByUser.get(uid) ?? { count: 0, base: 0 };
    cur.count += 1;
    cur.base += value;
    baseByUser.set(uid, cur);
  }

  const paidByUser = new Map<string, number>();
  const payoutsByUser = new Map<string, CollaboratorPayoutHistoryItem[]>();
  for (const p of payouts) {
    paidByUser.set(p.intraUserId, (paidByUser.get(p.intraUserId) ?? 0) + p.amountCents);
    const list = payoutsByUser.get(p.intraUserId) ?? [];
    list.push({
      payoutId: p.id,
      amountCents: p.amountCents,
      paidAtIso: p.paidAt.toISOString(),
      method: p.transaction.method,
      notes: p.notes,
      transactionId: p.financialTransactionId,
    });
    payoutsByUser.set(p.intraUserId, list);
  }

  const lines = members.map((m) => {
    const agg = baseByUser.get(m.id) ?? { count: 0, base: 0 };
    return buildCollaboratorBalanceLine({
      intraUserId: m.id,
      name: m.name,
      color: m.color,
      role: m.role,
      commissionRateBps: m.commissionRateBps,
      attendanceCount: agg.count,
      baseCents: agg.base,
      paidCents: paidByUser.get(m.id) ?? 0,
      attendances: attendancesByUser.get(m.id) ?? [],
      payouts: payoutsByUser.get(m.id) ?? [],
    });
  });

  const totals = lines.reduce(
    (acc, l) => {
      acc.baseCents += l.baseCents;
      acc.commissionDueCents += l.commissionDueCents;
      acc.paidCents += l.paidCents;
      acc.balanceCents += l.balanceCents;
      acc.attendanceCount += l.attendanceCount;
      return acc;
    },
    {
      grossIncomeCents: incomeAgg._sum.amountCents ?? 0,
      baseCents: 0,
      commissionDueCents: 0,
      paidCents: 0,
      balanceCents: 0,
      attendanceCount: 0,
      unassignedAttendanceCount,
    },
  );

  return { period, lines, totals };
}

export async function setIntraUserCommissionRateForTenant(params: {
  tenantId: string;
  intraUserId: string;
  commissionRateBps: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const bps = Math.trunc(params.commissionRateBps);
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) {
    return { ok: false, error: "Comissão deve ser entre 0% e 100%." };
  }
  const updated = await prisma.intraUser.updateMany({
    where: { id: params.intraUserId, userId: params.tenantId },
    data: { commissionRateBps: bps },
  });
  if (updated.count === 0) {
    return { ok: false, error: "Profissional não encontrado nesta conta." };
  }
  return { ok: true };
}

export async function recordCollaboratorPayoutForTenant(params: {
  tenantId: string;
  intraUserId: string;
  amountCents: number;
  method: FinancialTransactionMethod;
  period: CollaboratorPayoutPreset;
  offset?: number;
  anchorIso?: string | null;
  notes?: string | null;
  occurredAt?: Date;
}): Promise<
  | { ok: true; payoutId: string; transactionId: string; balanceAfterCents: number }
  | { ok: false; error: string }
> {
  const amount = Math.trunc(params.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Informe um valor de repasse válido." };
  }

  const period = resolveCollaboratorPeriod({
    preset: params.period,
    offset: params.offset ?? 0,
    anchorIso: params.anchorIso ?? null,
  });

  const member = await prisma.intraUser.findFirst({
    where: { id: params.intraUserId, userId: params.tenantId },
    select: { id: true, name: true, commissionRateBps: true },
  });
  if (!member) {
    return { ok: false, error: "Profissional não encontrado nesta conta." };
  }

  const report = await getCollaboratorBalanceReportForUser(params.tenantId, {
    preset: params.period,
    offset: params.offset ?? 0,
    anchorIso: params.anchorIso ?? null,
  });
  const line = report.lines.find((l) => l.intraUserId === member.id);
  if (!line) {
    return { ok: false, error: "Profissional não encontrado no balanço." };
  }
  if (amount > line.balanceCents) {
    return {
      ok: false,
      error: `Valor acima do saldo a pagar (${(line.balanceCents / 100).toFixed(2)}).`,
    };
  }

  const notes = params.notes ? sanitizeText(params.notes).slice(0, 500) : null;
  const occurredAt = params.occurredAt ?? new Date();
  const description = sanitizeText(
    `Repasse ${member.name} · ${period.label}${notes ? ` — ${notes}` : ""}`,
  ).slice(0, 400);

  try {
    const result = await prisma.$transaction(async (db) => {
      const tx = await db.financialTransaction.create({
        data: {
          professionalUserId: params.tenantId,
          kind: FinancialTransactionKind.EXPENSE,
          amountCents: amount,
          occurredAt,
          method: params.method,
          description,
          category: "repasse",
          expenseNature: ExpenseNature.VARIABLE,
          source: FinancialEntrySource.COLLABORATOR_PAYOUT,
          intraUserId: member.id,
          periodKey: period.periodKey,
        },
        select: { id: true },
      });

      const payout = await db.collaboratorPayout.create({
        data: {
          professionalUserId: params.tenantId,
          intraUserId: member.id,
          period: params.period as CollaboratorPayoutPeriod,
          periodKey: period.periodKey,
          periodStartUtc: period.startUtc,
          periodEndUtc: period.endUtc,
          commissionRateBps: member.commissionRateBps,
          baseCents: line.baseCents,
          commissionDueCents: line.commissionDueCents,
          amountCents: amount,
          financialTransactionId: tx.id,
          notes,
          paidAt: occurredAt,
        },
        select: { id: true },
      });

      return { payoutId: payout.id, transactionId: tx.id };
    });

    return {
      ok: true,
      ...result,
      balanceAfterCents: line.balanceCents - amount,
    };
  } catch (e) {
    console.error("[recordCollaboratorPayout]", e);
    return { ok: false, error: "Não foi possível registrar o repasse." };
  }
}

export { commissionCentsFromBase };

const PAYOUT_VOID_REASON = "Repasse de colaborador estornado pelo administrador.";

export async function voidCollaboratorPayoutForTenant(params: {
  tenantId: string;
  payoutId: string;
  reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const payout = await prisma.collaboratorPayout.findFirst({
    where: {
      id: params.payoutId,
      professionalUserId: params.tenantId,
      voidedAt: null,
    },
    select: {
      id: true,
      financialTransactionId: true,
      transaction: {
        select: {
          id: true,
          voidedAt: true,
          fiscalDocument: { select: { status: true } },
        },
      },
    },
  });
  if (!payout) {
    return { ok: false, error: "Repasse não encontrado ou já estornado." };
  }
  const nfse = payout.transaction.fiscalDocument?.status;
  if (nfse === "ISSUED" || nfse === "QUEUED" || nfse === "PROCESSING") {
    return {
      ok: false,
      error: "Não é possível estornar: há NFS-e emitida ou em fila neste lançamento.",
    };
  }

  const reason = sanitizeText(
    (params.reason?.trim() || PAYOUT_VOID_REASON).slice(0, 500),
  );
  const now = new Date();

  try {
    await prisma.$transaction(async (db) => {
      await db.collaboratorPayout.update({
        where: { id: payout.id },
        data: { voidedAt: now },
      });
      if (!payout.transaction.voidedAt) {
        await db.financialTransaction.update({
          where: { id: payout.financialTransactionId },
          data: { voidedAt: now, voidReason: reason },
        });
      }
    });
    return { ok: true };
  } catch (e) {
    console.error("[voidCollaboratorPayout]", e);
    return { ok: false, error: "Não foi possível estornar o repasse." };
  }
}

export async function recordCollaboratorPayoutBatchForTenant(params: {
  tenantId: string;
  method: FinancialTransactionMethod;
  period: CollaboratorPayoutPreset;
  offset?: number;
  anchorIso?: string | null;
}): Promise<
  | { ok: true; paidCount: number; totalCents: number }
  | { ok: false; error: string }
> {
  const report = await getCollaboratorBalanceReportForUser(params.tenantId, {
    preset: params.period,
    offset: params.offset ?? 0,
    anchorIso: params.anchorIso ?? null,
  });
  const due = report.lines.filter((l) => l.balanceCents > 0);
  if (due.length === 0) {
    return { ok: false, error: "Nenhum colaborador com saldo a pagar neste período." };
  }

  let paidCount = 0;
  let totalCents = 0;
  for (const line of due) {
    const result = await recordCollaboratorPayoutForTenant({
      tenantId: params.tenantId,
      intraUserId: line.intraUserId,
      amountCents: line.balanceCents,
      method: params.method,
      period: params.period,
      offset: params.offset,
      anchorIso: params.anchorIso,
      notes: "Repasse em lote (pagar todos)",
    });
    if (!result.ok) {
      if (paidCount === 0) return result;
      return {
        ok: false,
        error: `Pagos ${paidCount} colaborador(es); falhou em ${line.name}: ${result.error}`,
      };
    }
    paidCount += 1;
    totalCents += line.balanceCents;
  }
  return { ok: true, paidCount, totalCents };
}

/** Resumo leve para badge do menu Analisar (mês corrente). */
export async function getCollaboratorBalanceDueSummaryForUser(
  professionalUserId: string,
): Promise<{ balanceCents: number; dueCount: number }> {
  const report = await getCollaboratorBalanceReportForUser(professionalUserId, {
    preset: "MONTH",
    offset: 0,
  });
  return {
    balanceCents: report.totals.balanceCents,
    dueCount: report.lines.filter((l) => l.balanceCents > 0).length,
  };
}
