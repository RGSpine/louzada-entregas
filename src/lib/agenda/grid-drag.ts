import { DateTime } from "luxon";

/** Alinhado a `dayBoundaries` / `gridStep` em AgendaScheduleXView. */
export const AGENDA_DAY_START_HOUR = 7;
export const AGENDA_DAY_END_HOUR = 21;
export const AGENDA_GRID_STEP_MINUTES = 30;

const DAY_MINUTES = (AGENDA_DAY_END_HOUR - AGENDA_DAY_START_HOUR) * 60;

export function minutesPerPixel(dayColumnHeightPx: number): number {
  if (dayColumnHeightPx <= 0) return 1;
  return DAY_MINUTES / dayColumnHeightPx;
}

export function snapDeltaMinutes(deltaMinutes: number, step = AGENDA_GRID_STEP_MINUTES): number {
  if (step <= 0) return deltaMinutes;
  return Math.round(deltaMinutes / step) * step;
}

export function clampStartLocal(dt: DateTime): DateTime {
  const dayStart = dt.startOf("day").plus({ hours: AGENDA_DAY_START_HOUR });
  const dayEnd = dt.startOf("day").plus({ hours: AGENDA_DAY_END_HOUR });
  if (dt < dayStart) return dayStart;
  const maxStart = dayEnd.minus({ minutes: AGENDA_GRID_STEP_MINUTES });
  if (dt > maxStart) return maxStart;
  return dt;
}

export type RescheduleFromDragParams = {
  startAtUtc: Date;
  endAtUtc: Date;
  dayColumnDelta: number;
  minutesDelta: number;
};

export function computeRescheduleFromDrag(
  startAtUtc: Date,
  endAtUtc: Date,
  timeZone: string,
  deltaXPx: number,
  deltaYPx: number,
  dayColumnWidthPx: number,
  dayColumnHeightPx: number,
): RescheduleFromDragParams {
  const startLocal = DateTime.fromJSDate(startAtUtc, { zone: "utc" }).setZone(timeZone);
  const endLocal = DateTime.fromJSDate(endAtUtc, { zone: "utc" }).setZone(timeZone);
  const durationMinutes = Math.max(
    AGENDA_GRID_STEP_MINUTES,
    Math.round(endLocal.diff(startLocal, "minutes").minutes),
  );

  const pxPerMin = minutesPerPixel(dayColumnHeightPx);
  const rawMinutesDelta = deltaYPx * pxPerMin;
  const minutesDelta = snapDeltaMinutes(rawMinutesDelta);

  let dayColumnDelta = 0;
  if (dayColumnWidthPx > 0) {
    dayColumnDelta = Math.round(deltaXPx / dayColumnWidthPx);
  }

  let nextStart = startLocal.plus({ days: dayColumnDelta, minutes: minutesDelta });
  nextStart = clampStartLocal(nextStart);
  const nextEnd = nextStart.plus({ minutes: durationMinutes });

  return {
    startAtUtc: nextStart.toUTC().toJSDate(),
    endAtUtc: nextEnd.toUTC().toJSDate(),
    dayColumnDelta,
    minutesDelta,
  };
}

export function appointmentAllowsGridDrag(status: string | undefined): boolean {
  return status === "SCHEDULED";
}
