import { DateTime } from "luxon";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export const MARKETPLACE_SLOT_DAYS = 7;
export const MARKETPLACE_WORK_START_HOUR = 8;
export const MARKETPLACE_WORK_END_HOUR = 18;
export const MARKETPLACE_SLOT_MINUTES = 60;
export const MARKETPLACE_DEFAULT_BASE_PRICE = 150;

export type IdleSlotWindow = {
  startUtc: Date;
  endUtc: Date;
};

/** Janela configurada pelo profissional (dias + faixa horária). */
export type OfferWindowDef = {
  recurrence: "WEEKLY" | "ONCE";
  /** Luxon weekday 1–7. Usado em WEEKLY. */
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  /** yyyy-MM-dd ou Date — só ONCE. */
  specificDate?: string | Date | null;
};

export const DEFAULT_OFFER_WINDOW: OfferWindowDef = {
  recurrence: "WEEKLY",
  weekdays: [1, 2, 3, 4, 5, 6],
  startMinute: MARKETPLACE_WORK_START_HOUR * 60,
  endMinute: MARKETPLACE_WORK_END_HOUR * 60,
};

function isWorkday(dt: DateTime): boolean {
  return dt.weekday >= 1 && dt.weekday <= 6;
}

function civilDateKey(dt: DateTime): string {
  return dt.toFormat("yyyy-LL-dd");
}

function specificDateKey(
  value: string | Date | null | undefined,
  timezone: string,
): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  return DateTime.fromJSDate(value, { zone: "utc" }).setZone(timezone).toFormat("yyyy-LL-dd");
}

function windowAppliesToDay(
  window: OfferWindowDef,
  localDay: DateTime,
  timezone: string,
): boolean {
  if (window.recurrence === "ONCE") {
    const key = specificDateKey(window.specificDate, timezone);
    return key != null && key === civilDateKey(localDay);
  }
  if (!window.weekdays.length) return false;
  return window.weekdays.includes(localDay.weekday);
}

/**
 * Grade de ociosidade nos próximos N dias.
 * Sem `offerWindows` (ou lista vazia) → padrão seg–sáb 8h–18h.
 */
export function buildIdleSlotWindows(
  from: Date,
  days = MARKETPLACE_SLOT_DAYS,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
  offerWindows?: OfferWindowDef[] | null,
): IdleSlotWindow[] {
  const windows = offerWindows?.length ? offerWindows : [DEFAULT_OFFER_WINDOW];
  const startDay = DateTime.fromJSDate(from, { zone: "utc" })
    .setZone(timezone)
    .startOf("day");
  const out: IdleSlotWindow[] = [];
  const seen = new Set<string>();

  for (let day = 0; day < days; day += 1) {
    const localDay = startDay.plus({ days: day });

    for (const window of windows) {
      if (!windowAppliesToDay(window, localDay, timezone)) continue;
      // Grade legada sem janelas custom: pula domingo.
      if (!offerWindows?.length && !isWorkday(localDay)) continue;

      const startMinute = Math.max(0, window.startMinute);
      const endMinute = Math.min(24 * 60, window.endMinute);
      if (endMinute - startMinute < MARKETPLACE_SLOT_MINUTES) continue;

      for (
        let minute = startMinute;
        minute + MARKETPLACE_SLOT_MINUTES <= endMinute;
        minute += MARKETPLACE_SLOT_MINUTES
      ) {
        const hour = Math.floor(minute / 60);
        const min = minute % 60;
        const localStart = localDay.set({
          hour,
          minute: min,
          second: 0,
          millisecond: 0,
        });
        if (localStart.toUTC().toJSDate().getTime() <= from.getTime()) continue;
        const startUtc = localStart.toUTC().toJSDate();
        const key = startUtc.toISOString();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          startUtc,
          endUtc: localStart
            .plus({ minutes: MARKETPLACE_SLOT_MINUTES })
            .toUTC()
            .toJSDate(),
        });
      }
    }
  }

  out.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return out;
}

export function centsToReais(cents: number | null | undefined): number {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) {
    return MARKETPLACE_DEFAULT_BASE_PRICE;
  }
  return Math.round(cents) / 100;
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export function minutesToTimeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeLabelToMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}
