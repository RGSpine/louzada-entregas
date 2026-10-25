import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

/** Arredonda minutos para o múltiplo mais próximo (ex.: 10:02 → 10:00 com step 5). */
export function snapTimeValue(timeValue: string, stepMinutes = 5): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim());
  if (!match) return timeValue;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return timeValue;
  const total = hour * 60 + minute;
  const snapped = Math.round(total / stepMinutes) * stepMinutes;
  const clamped = Math.min(23 * 60 + 55, Math.max(0, snapped));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftTimeValue(timeValue: string, deltaMinutes: number): string {
  const base = DateTime.fromFormat(snapTimeValue(timeValue, 1), "HH:mm");
  if (!base.isValid) return timeValue;
  return base.plus({ minutes: deltaMinutes }).toFormat("HH:mm");
}

export function scheduleXDateTimeToUtcDate(
  value: Temporal.ZonedDateTime | Temporal.PlainDate | string | Date,
  timeZone: string = DEFAULT_SCHEDULE_TIMEZONE,
): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const asZoned = DateTime.fromISO(value, { setZone: true });
    if (asZoned.isValid) return asZoned.toUTC().toJSDate();
    throw new Error(`Data Schedule-X inválida: ${value}`);
  }
  if ("hour" in value) {
    const z = value as Temporal.ZonedDateTime;
    return DateTime.fromObject(
      {
        year: z.year,
        month: z.month,
        day: z.day,
        hour: z.hour,
        minute: z.minute,
        second: z.second ?? 0,
      },
      { zone: z.timeZoneId || timeZone },
    )
      .toUTC()
      .toJSDate();
  }
  const p = value as Temporal.PlainDate;
  return DateTime.fromObject(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 },
    { zone: timeZone },
  )
    .toUTC()
    .toJSDate();
}

export function formatSlotHint(dateValue: string, timeValue: string, timeZone = DEFAULT_SCHEDULE_TIMEZONE): string {
  const dt = DateTime.fromFormat(`${dateValue} ${timeValue}`, "yyyy-LL-dd HH:mm", { zone: timeZone });
  if (!dt.isValid) return "Horário selecionado no calendário. Você pode alterar data e hora abaixo.";
  return `Sugestão do calendário: ${dt.toFormat("cccc, dd/LL 'às' HH:mm")}. Altere data/hora abaixo se quiser.`;
}
