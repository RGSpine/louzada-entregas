/**
 * Materialização idempotente de despesas fixas (RecurringExpense) como
 * lançamentos reais de caixa (FinancialTransaction, source=RECURRING).
 *
 * Cada ocorrência dentro do intervalo recebe uma `periodKey` estável por
 * frequência; a unicidade (recurringExpenseId, periodKey) garante que rodar
 * a materialização várias vezes não duplica lançamentos. Linhas já existentes
 * (inclusive editadas manualmente) nunca são sobrescritas.
 */
import { DateTime } from "luxon";
import {
  FinancialEntrySource,
  FinancialTransactionKind,
  RecurringExpenseFrequency,
  type RecurringExpense,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

/** Limite defensivo contra loops longos (ex.: visão anual com despesa semanal ≈ 52). */
const MAX_OCCURRENCES_PER_EXPENSE = 400;

type Occurrence = { occurredAtUtc: Date; periodKey: string };

export const RECURRING_DEACTIVATED_VOID_REASON = "recurring:deactivated";
export const RECURRING_DELETED_VOID_REASON = "recurring:deleted";

export function occurrenceKey(
  freq: RecurringExpenseFrequency,
  localDate: DateTime,
): string {
  switch (freq) {
    case RecurringExpenseFrequency.WEEKLY:
      return `rec-W:${localDate.weekYear}-W${String(localDate.weekNumber).padStart(2, "0")}`;
    case RecurringExpenseFrequency.MONTHLY:
      return `rec-M:${localDate.toFormat("yyyy-LL")}`;
    case RecurringExpenseFrequency.YEARLY:
      return `rec-Y:${localDate.year}`;
  }
}

/** Enumera as ocorrências de uma despesa fixa dentro de [startUtc, endUtc). */
export function enumerateOccurrences(
  expense: Pick<RecurringExpense, "frequency" | "anchorDay" | "startedAt" | "endedAt">,
  startUtc: Date,
  endUtc: Date,
  timezone: string,
): Occurrence[] {
  const tz = timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const rangeStart = DateTime.fromJSDate(startUtc, { zone: "utc" }).setZone(tz);
  const rangeEnd = DateTime.fromJSDate(endUtc, { zone: "utc" }).setZone(tz);
  const liveFrom = DateTime.fromJSDate(expense.startedAt, { zone: "utc" }).setZone(tz);
  const liveUntil = expense.endedAt
    ? DateTime.fromJSDate(expense.endedAt, { zone: "utc" }).setZone(tz)
    : null;

  const out: Occurrence[] = [];
  const push = (local: DateTime) => {
    if (local < rangeStart || local >= rangeEnd) return;
    // Vigência pelo período (mês/semana/ano), não pelo horário do cadastro:
    // aluguel cadastrado dia 17 com vencimento dia 5 ainda entra no mês corrente.
    if (expense.frequency === RecurringExpenseFrequency.WEEKLY) {
      if (local < liveFrom.startOf("week")) return;
    } else if (expense.frequency === RecurringExpenseFrequency.YEARLY) {
      if (local < liveFrom.startOf("year")) return;
    } else if (local < liveFrom.startOf("month")) {
      return;
    }
    if (liveUntil && local > liveUntil.endOf("day")) return;
    out.push({
      occurredAtUtc: local.toUTC().toJSDate(),
      periodKey: occurrenceKey(expense.frequency, local),
    });
  };

  if (expense.frequency === RecurringExpenseFrequency.WEEKLY) {
    // anchorDay = dia da semana (1=segunda ... 7=domingo)
    const weekday = Math.min(Math.max(expense.anchorDay, 1), 7);
    let cursor = rangeStart.startOf("week");
    for (let i = 0; i < MAX_OCCURRENCES_PER_EXPENSE && cursor < rangeEnd; i++) {
      push(cursor.set({ weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 }));
      cursor = cursor.plus({ weeks: 1 });
    }
  } else if (expense.frequency === RecurringExpenseFrequency.MONTHLY) {
    let cursor = rangeStart.startOf("month");
    for (let i = 0; i < MAX_OCCURRENCES_PER_EXPENSE && cursor < rangeEnd; i++) {
      const day = Math.min(Math.max(expense.anchorDay, 1), cursor.daysInMonth ?? 28);
      push(cursor.set({ day, hour: 12, minute: 0, second: 0, millisecond: 0 }));
      cursor = cursor.plus({ months: 1 });
    }
  } else {
    // YEARLY: usa o mês de startedAt como âncora e anchorDay como dia.
    const anchorMonth = liveFrom.month;
    let cursor = rangeStart.startOf("year");
    for (let i = 0; i < MAX_OCCURRENCES_PER_EXPENSE && cursor < rangeEnd; i++) {
      const atMonth = cursor.set({ month: anchorMonth });
      const day = Math.min(Math.max(expense.anchorDay, 1), atMonth.daysInMonth ?? 28);
      push(atMonth.set({ day, hour: 12, minute: 0, second: 0, millisecond: 0 }));
      cursor = cursor.plus({ years: 1 });
    }
  }

  return out;
}

/**
 * Garante que todas as ocorrências de despesas fixas ativas do profissional
 * dentro de [startUtc, endUtc) existem como FinancialTransaction. Idempotente.
 * Retorna quantos lançamentos foram criados nesta chamada.
 */
export async function materializeRecurringExpensesForRange(params: {
  professionalUserId: string;
  startUtc: Date;
  endUtc: Date;
  timezone?: string;
}): Promise<number> {
  const tz = params.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;

  const expenses = await prisma.recurringExpense.findMany({
    where: {
      professionalUserId: params.professionalUserId,
      active: true,
      startedAt: { lt: params.endUtc },
      OR: [{ endedAt: null }, { endedAt: { gte: params.startUtc } }],
    },
  });

  if (expenses.length === 0) return 0;

  const rows: Array<{
    professionalUserId: string;
    kind: FinancialTransactionKind;
    amountCents: number;
    occurredAt: Date;
    method: RecurringExpense["method"];
    description: string | null;
    category: string | null;
    expenseNature: "FIXED";
    source: FinancialEntrySource;
    recurringExpenseId: string;
    periodKey: string;
    serviceSpaceId: string | null;
  }> = [];

  for (const exp of expenses) {
    const occurrences = enumerateOccurrences(exp, params.startUtc, params.endUtc, tz);
    for (const occ of occurrences) {
      rows.push({
        professionalUserId: params.professionalUserId,
        kind: FinancialTransactionKind.EXPENSE,
        amountCents: exp.amountCents,
        occurredAt: occ.occurredAtUtc,
        method: exp.method,
        description: exp.name,
        category: exp.category,
        expenseNature: "FIXED",
        source: FinancialEntrySource.RECURRING,
        recurringExpenseId: exp.id,
        periodKey: occ.periodKey,
        serviceSpaceId: exp.serviceSpaceId,
      });
    }
  }

  if (rows.length === 0) return 0;

  // skipDuplicates apoia-se no índice único (recurring_expense_id, period_key):
  // não duplica e não sobrescreve lançamentos já materializados/editados.
  const result = await prisma.financialTransaction.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

/** Chave do período que contém `at` (mesmo formato da materialização). */
export function recurringPeriodKeyAt(
  freq: RecurringExpenseFrequency,
  at: Date,
  timezone?: string,
): string {
  const tz = timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const local = DateTime.fromJSDate(at, { zone: "utc" }).setZone(tz);
  return occurrenceKey(freq, local);
}

/**
 * Estorna lançamentos automáticos (source=RECURRING) deste gasto a partir do
 * período de `fromUtc` (mês/semana/ano corrente inclusive). Histórico anterior
 * permanece. Não mexe em linhas com NFS-e emitida/em fila.
 */
export async function voidRecurringTransactionsFromPeriod(params: {
  professionalUserId: string;
  recurringExpenseId: string;
  frequency: RecurringExpenseFrequency;
  fromUtc: Date;
  timezone?: string;
  reason: string;
}): Promise<number> {
  const cutoffKey = recurringPeriodKeyAt(
    params.frequency,
    params.fromUtc,
    params.timezone,
  );
  const result = await prisma.financialTransaction.updateMany({
    where: {
      professionalUserId: params.professionalUserId,
      recurringExpenseId: params.recurringExpenseId,
      source: FinancialEntrySource.RECURRING,
      voidedAt: null,
      periodKey: { gte: cutoffKey },
      OR: [
        { fiscalDocument: { is: null } },
        { fiscalDocument: { is: { status: { notIn: ["ISSUED", "QUEUED", "PROCESSING"] } } } },
      ],
    },
    data: {
      voidedAt: new Date(),
      voidReason: params.reason,
    },
  });
  return result.count;
}

/** Reabre estornos feitos ao desativar, para a rematerialização voltar a contar. */
export async function restoreDeactivatedRecurringTransactions(params: {
  professionalUserId: string;
  recurringExpenseId: string;
}): Promise<number> {
  const result = await prisma.financialTransaction.updateMany({
    where: {
      professionalUserId: params.professionalUserId,
      recurringExpenseId: params.recurringExpenseId,
      source: FinancialEntrySource.RECURRING,
      voidReason: RECURRING_DEACTIVATED_VOID_REASON,
      voidedAt: { not: null },
    },
    data: {
      voidedAt: null,
      voidReason: null,
    },
  });
  return result.count;
}

/**
 * Gastos já inativos deixam de contar a partir de `fromUtc` (início do período
 * analisado) e nos períodos seguintes. Sem `fromUtc`, usa agora — só para
 * caminhos que não são relatório (desativar no mês corrente).
 */
export async function voidInactiveRecurringFromCurrentPeriod(params: {
  professionalUserId: string;
  fromUtc?: Date;
  timezone?: string;
}): Promise<number> {
  const fromUtc = params.fromUtc ?? new Date();
  const inactive = await prisma.recurringExpense.findMany({
    where: { professionalUserId: params.professionalUserId, active: false },
    select: { id: true, frequency: true },
  });
  if (inactive.length === 0) return 0;

  let total = 0;
  for (const exp of inactive) {
    total += await voidRecurringTransactionsFromPeriod({
      professionalUserId: params.professionalUserId,
      recurringExpenseId: exp.id,
      frequency: exp.frequency,
      fromUtc,
      timezone: params.timezone,
      reason: RECURRING_DEACTIVATED_VOID_REASON,
    });
  }
  return total;
}
