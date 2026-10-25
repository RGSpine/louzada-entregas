/**
 * Relatório financeiro por período — módulo server-only (NÃO é Server Action).
 * Chamado por getFinancePeriodReport (action autenticada) e pelo worker do agente.
 */
import "server-only";

import { z } from "zod";
import { DateTime } from "luxon";
import {
  ExpenseNature,
  FinancialTransactionKind,
  FinancialTransactionMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  FINANCE_PERIOD_PRESETS,
  resolveFinancePeriod,
  previousFinancePeriod,
  type ResolvedFinancePeriod,
} from "@/lib/finance/period";
import {
  materializeRecurringExpensesForRange,
  voidInactiveRecurringFromCurrentPeriod,
} from "@/lib/finance/recurring-expense";
import {
  parseServiceSpaceViewParam,
  serviceSpaceWhere,
} from "@/lib/service-spaces/access";

export type FinancePeriodTotals = {
  grossIncomeCents: number;
  fixedExpenseCents: number;
  variableExpenseCents: number;
  totalExpenseCents: number;
  netCents: number;
  transactionCount: number;
};

export type FinancePeriodReport = {
  preset: (typeof FINANCE_PERIOD_PRESETS)[number];
  label: string;
  periodKey: string;
  anchorIso: string;
  startIso: string;
  endIso: string;
  totals: FinancePeriodTotals;
  previous: {
    label: string;
    totals: FinancePeriodTotals;
    grossDeltaPct: number | null;
    netDeltaPct: number | null;
  };
  byCategory: Array<{ category: string; incomeCents: number; expenseCents: number }>;
  byMethod: Array<{
    method: FinancialTransactionMethod;
    incomeCents: number;
    expenseCents: number;
  }>;
  topPatients: Array<{ patientId: string; name: string; incomeCents: number }>;
  timeseries: Array<{
    key: string;
    label: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
};

export type FinancePeriodReportResult =
  | { success: true; data: FinancePeriodReport }
  | { success: false; error: string };

const periodReportSchema = z.object({
  preset: z.enum(FINANCE_PERIOD_PRESETS),
  anchorIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  offset: z.coerce.number().int().min(-1200).max(1200).optional(),
  serviceSpaceId: z.string().min(1).optional(),
});

type TxRow = {
  kind: FinancialTransactionKind;
  amountCents: number;
  occurredAt: Date;
  method: FinancialTransactionMethod;
  category: string | null;
  expenseNature: ExpenseNature | null;
  patientId: string | null;
};

function emptyTotals(): FinancePeriodTotals {
  return {
    grossIncomeCents: 0,
    fixedExpenseCents: 0,
    variableExpenseCents: 0,
    totalExpenseCents: 0,
    netCents: 0,
    transactionCount: 0,
  };
}

function accumulateTotals(rows: TxRow[]): FinancePeriodTotals {
  const t = emptyTotals();
  t.transactionCount = rows.length;
  for (const r of rows) {
    if (r.kind === FinancialTransactionKind.INCOME) {
      t.grossIncomeCents += r.amountCents;
    } else if (r.expenseNature === ExpenseNature.FIXED) {
      t.fixedExpenseCents += r.amountCents;
    } else {
      t.variableExpenseCents += r.amountCents;
    }
  }
  t.totalExpenseCents = t.fixedExpenseCents + t.variableExpenseCents;
  t.netCents = t.grossIncomeCents - t.totalExpenseCents;
  return t;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function timeseriesBucket(
  preset: (typeof FINANCE_PERIOD_PRESETS)[number],
): "hour" | "day" | "month" {
  if (preset === "DAY") return "hour";
  if (preset === "WEEK" || preset === "MONTH") return "day";
  return "month";
}

function buildTimeseries(
  rows: TxRow[],
  preset: (typeof FINANCE_PERIOD_PRESETS)[number],
  tz: string,
): FinancePeriodReport["timeseries"] {
  const bucket = timeseriesBucket(preset);
  const map = new Map<string, { label: string; incomeCents: number; expenseCents: number }>();
  for (const r of rows) {
    const dt = DateTime.fromJSDate(r.occurredAt, { zone: "utc" }).setZone(tz);
    let key: string;
    let label: string;
    if (bucket === "hour") {
      key = dt.toFormat("yyyy-LL-dd-HH");
      label = dt.toFormat("HH'h'");
    } else if (bucket === "day") {
      key = dt.toFormat("yyyy-LL-dd");
      label = dt.toFormat("dd/LL");
    } else {
      key = dt.toFormat("yyyy-LL");
      label = dt.toFormat("LL/yy");
    }
    const cur = map.get(key) ?? { label, incomeCents: 0, expenseCents: 0 };
    if (r.kind === FinancialTransactionKind.INCOME) cur.incomeCents += r.amountCents;
    else cur.expenseCents += r.amountCents;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => ({
      key,
      label: v.label,
      incomeCents: v.incomeCents,
      expenseCents: v.expenseCents,
      netCents: v.incomeCents - v.expenseCents,
    }));
}

async function loadPeriodRows(
  professionalUserId: string,
  period: ResolvedFinancePeriod,
  serviceSpaceId?: string,
): Promise<TxRow[]> {
  const spaceClause = serviceSpaceWhere(parseServiceSpaceViewParam(serviceSpaceId));
  return prisma.financialTransaction.findMany({
    where: {
      professionalUserId,
      occurredAt: { gte: period.startUtc, lt: period.endUtc },
      voidedAt: null,
      ...(spaceClause ?? {}),
    },
    select: {
      kind: true,
      amountCents: true,
      occurredAt: true,
      method: true,
      category: true,
      expenseNature: true,
      patientId: true,
    },
    orderBy: { occurredAt: "asc" },
  });
}

/**
 * Relatório completo do período. Uso interno apenas (worker / action autenticada).
 * Nunca exportar como Server Action — o caller deve garantir auth/RBAC.
 */
export async function getFinancePeriodReportForUser(
  professionalUserId: string,
  input: unknown,
): Promise<FinancePeriodReportResult> {
  const parsed = periodReportSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const tz = DEFAULT_SCHEDULE_TIMEZONE;
  const period = resolveFinancePeriod({
    preset: parsed.data.preset,
    anchorIso: parsed.data.anchorIso ?? null,
    offset: parsed.data.offset ?? 0,
    timezone: tz,
  });
  const prev = previousFinancePeriod(period);

  await Promise.all([
    materializeRecurringExpensesForRange({
      professionalUserId,
      startUtc: period.startUtc,
      endUtc: period.endUtc,
      timezone: tz,
    }),
    materializeRecurringExpensesForRange({
      professionalUserId,
      startUtc: prev.startUtc,
      endUtc: prev.endUtc,
      timezone: tz,
    }),
    voidInactiveRecurringFromCurrentPeriod({
      professionalUserId,
      fromUtc: period.startUtc,
      timezone: tz,
    }),
  ]);

  const [rows, prevRows] = await Promise.all([
    loadPeriodRows(professionalUserId, period, parsed.data.serviceSpaceId),
    loadPeriodRows(professionalUserId, prev, parsed.data.serviceSpaceId),
  ]);

  const totals = accumulateTotals(rows);
  const prevTotals = accumulateTotals(prevRows);

  const catMap = new Map<string, { incomeCents: number; expenseCents: number }>();
  for (const r of rows) {
    const cat =
      (r.category && r.category.trim()) ||
      (r.kind === FinancialTransactionKind.INCOME ? "Receitas" : "Sem categoria");
    const cur = catMap.get(cat) ?? { incomeCents: 0, expenseCents: 0 };
    if (r.kind === FinancialTransactionKind.INCOME) cur.incomeCents += r.amountCents;
    else cur.expenseCents += r.amountCents;
    catMap.set(cat, cur);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents));

  const methodMap = new Map<
    FinancialTransactionMethod,
    { incomeCents: number; expenseCents: number }
  >();
  for (const r of rows) {
    const cur = methodMap.get(r.method) ?? { incomeCents: 0, expenseCents: 0 };
    if (r.kind === FinancialTransactionKind.INCOME) cur.incomeCents += r.amountCents;
    else cur.expenseCents += r.amountCents;
    methodMap.set(r.method, cur);
  }
  const byMethod = [...methodMap.entries()].map(([method, v]) => ({ method, ...v }));

  const patientMap = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === FinancialTransactionKind.INCOME && r.patientId) {
      patientMap.set(r.patientId, (patientMap.get(r.patientId) ?? 0) + r.amountCents);
    }
  }
  const topPatientIds = [...patientMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  let topPatients: FinancePeriodReport["topPatients"] = [];
  if (topPatientIds.length > 0) {
    const patients = await prisma.patient.findMany({
      where: { id: { in: topPatientIds.map(([id]) => id) }, userId: professionalUserId },
      select: { id: true, name: true },
    });
    const nameById = new Map(patients.map((p) => [p.id, p.name]));
    topPatients = topPatientIds.map(([patientId, incomeCents]) => ({
      patientId,
      name: nameById.get(patientId) ?? "Paciente",
      incomeCents,
    }));
  }

  return {
    success: true,
    data: {
      preset: period.preset,
      label: period.label,
      periodKey: period.periodKey,
      anchorIso: period.anchorIso,
      startIso: period.startUtc.toISOString(),
      endIso: period.endUtc.toISOString(),
      totals,
      previous: {
        label: prev.label,
        totals: prevTotals,
        grossDeltaPct: pctDelta(totals.grossIncomeCents, prevTotals.grossIncomeCents),
        netDeltaPct: pctDelta(totals.netCents, prevTotals.netCents),
      },
      byCategory,
      byMethod,
      topPatients,
      timeseries: buildTimeseries(rows, period.preset, tz),
    },
  };
}
