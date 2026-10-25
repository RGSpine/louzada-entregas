import { DateTime } from "luxon";
import { findAppointmentOverlap } from "@/lib/appointment-availability";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export type SuggestedSlot = {
  startUtc: Date;
  endUtc: Date;
  label: string;
};

const STEP_MINUTES = 15;
const MAX_SCAN_DAYS = 14;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 19;

/**
 * Sugere horários livres a partir do instante pedido (mesmo dia e dias seguintes).
 */
export async function suggestAlternativeSlots(params: {
  professionalUserId: string;
  preferredStartUtc: Date;
  durationMinutes: number;
  timezone?: string;
  maxSuggestions?: number;
}): Promise<SuggestedSlot[]> {
  const tz = params.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const max = params.maxSuggestions ?? 3;
  const duration = Math.max(15, params.durationMinutes);
  const out: SuggestedSlot[] = [];

  let cursor = DateTime.fromJSDate(params.preferredStartUtc, { zone: "utc" })
    .setZone(tz)
    .plus({ minutes: STEP_MINUTES });

  const endScan = cursor.plus({ days: MAX_SCAN_DAYS });

  while (out.length < max && cursor < endScan) {
    if (cursor.hour < WORK_START_HOUR) {
      cursor = cursor.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
    }
    if (cursor.hour >= WORK_END_HOUR) {
      cursor = cursor.plus({ days: 1 }).set({
        hour: WORK_START_HOUR,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      continue;
    }

    const startUtc = cursor.toUTC().toJSDate();
    const endUtc = cursor.plus({ minutes: duration }).toUTC().toJSDate();
    const overlap = await findAppointmentOverlap(
      params.professionalUserId,
      startUtc,
      endUtc,
    );

    if (!overlap.overlapping) {
      out.push({
        startUtc,
        endUtc,
        label: cursor.toFormat("dd/LL HH:mm"),
      });
      cursor = cursor.plus({ minutes: duration });
    } else {
      cursor = cursor.plus({ minutes: STEP_MINUTES });
    }
  }

  return out;
}

export function formatSuggestedSlotsMessage(slots: SuggestedSlot[]): string {
  if (slots.length === 0) return "";
  const lines = slots.map((s) => s.label).join(", ");
  return ` Horários livres sugeridos: ${lines}.`;
}
