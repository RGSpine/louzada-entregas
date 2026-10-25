/**
 * Helpers de início de vigência e materialização pós-gravação de gastos fixos.
 */
import { DateTime } from "luxon";
import { RecurringExpenseFrequency } from "@prisma/client";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { materializeRecurringExpensesForRange } from "@/lib/finance/recurring-expense";

/** Início do período corrente (mês/semana/ano) no fuso do consultório. */
export function defaultRecurringStartedAt(
  frequency: RecurringExpenseFrequency,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): Date {
  const now = DateTime.now().setZone(timezone || DEFAULT_SCHEDULE_TIMEZONE);
  if (frequency === RecurringExpenseFrequency.WEEKLY) {
    return now.startOf("week").toUTC().toJSDate();
  }
  if (frequency === RecurringExpenseFrequency.YEARLY) {
    return now.startOf("year").toUTC().toJSDate();
  }
  return now.startOf("month").toUTC().toJSDate();
}

/** Materializa o mês atual e o seguinte (cobre âncora futura no mês). */
export async function materializeRecurringAroundNow(params: {
  professionalUserId: string;
  timezone?: string;
}): Promise<number> {
  const tz = params.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const startUtc = now.startOf("month").toUTC().toJSDate();
  const endUtc = now.plus({ months: 2 }).startOf("month").toUTC().toJSDate();
  return materializeRecurringExpensesForRange({
    professionalUserId: params.professionalUserId,
    startUtc,
    endUtc,
    timezone: tz,
  });
}
