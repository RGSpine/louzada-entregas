import { DateTime } from "luxon";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export const SESSION_DURATION_PRESETS = [30, 45, 60] as const;

export const MIN_RECURRENCE_SESSIONS = 2;
export const MAX_RECURRENCE_SESSIONS = 40;

export const WEEKDAY_OPTIONS = [
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terça" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sáb", label: "Sábado" },
  { value: 7, short: "Dom", label: "Domingo" },
] as const;

export type RecurrenceSlot = {
  startAt: Date;
  endAt: Date;
  index: number;
  label: string;
};

function uniqueSortedWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/**
 * Monta N sessões a partir da marcação atual.
 * A primeira é sempre o horário âncora (mesmo que o dia da semana não esteja
 * nos dias escolhidos). As seguintes caem só nos weekdays selecionados, no
 * mesmo relógio local.
 */
export function buildRecurrenceSlots(params: {
  firstStartAt: Date;
  durationMinutes: number;
  sessionCount: number;
  weekdays: number[];
  timezone?: string;
}): RecurrenceSlot[] {
  const tz = params.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const duration = Math.min(180, Math.max(15, Math.round(params.durationMinutes)));
  const sessionCount = Math.min(
    MAX_RECURRENCE_SESSIONS,
    Math.max(MIN_RECURRENCE_SESSIONS, Math.round(params.sessionCount)),
  );
  const weekdays = uniqueSortedWeekdays(params.weekdays);
  if (weekdays.length === 0) {
    throw new Error("Selecione pelo menos um dia da semana.");
  }

  const firstLocal = DateTime.fromJSDate(params.firstStartAt, { zone: "utc" }).setZone(tz);
  if (!firstLocal.isValid) {
    throw new Error("Data inicial inválida para a série.");
  }

  const toSlot = (startLocal: DateTime, index: number): RecurrenceSlot => {
    const endLocal = startLocal.plus({ minutes: duration });
    return {
      startAt: startLocal.toUTC().toJSDate(),
      endAt: endLocal.toUTC().toJSDate(),
      index,
      label: startLocal.toFormat("ccc dd/LL/yyyy HH:mm"),
    };
  };

  const slots: RecurrenceSlot[] = [toSlot(firstLocal, 0)];
  let cursor = firstLocal.startOf("day").plus({ days: 1 });
  const maxDays = sessionCount * 14 + 14;
  let walked = 0;

  while (slots.length < sessionCount && walked < maxDays) {
    if (weekdays.includes(cursor.weekday)) {
      const startLocal = cursor.set({
        hour: firstLocal.hour,
        minute: firstLocal.minute,
        second: 0,
        millisecond: 0,
      });
      slots.push(toSlot(startLocal, slots.length));
    }
    cursor = cursor.plus({ days: 1 });
    walked += 1;
  }

  if (slots.length < sessionCount) {
    throw new Error(
      `Não foi possível montar ${sessionCount} sessões nos dias escolhidos. Tente menos sessões ou mais dias da semana.`,
    );
  }

  return slots;
}
