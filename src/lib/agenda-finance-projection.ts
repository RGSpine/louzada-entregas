import { DateTime } from "luxon";
import {
  AppointmentStatus,
  AppointmentVisitKind,
  AppointmentConfirmationStatus,
} from "@prisma/client";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export type AgendaProjectionAppointmentRow = {
  startAt: Date;
  status: AppointmentStatus;
  visitKind: AppointmentVisitKind;
  priceCents: number | null;
  confirmationStatus?: AppointmentConfirmationStatus;
};

export type AgendaFinanceProjectionDay = {
  dateIso: string;
  label: string;
  scheduledCashCents: number;
  completedCashCents: number;
  planScheduledCount: number;
  planCompletedCount: number;
  appointmentCount: number;
};

export type AgendaFinanceProjection = {
  scheduledCashCents: number;
  scheduledCashCount: number;
  completedCashCents: number;
  completedCashCount: number;
  planScheduledCount: number;
  planScheduledValueCents: number;
  planCompletedCount: number;
  planCompletedValueCents: number;
  pendingConfirmationCount: number;
  weekTotalCashCents: number;
  byDay: AgendaFinanceProjectionDay[];
};

export function resolveAppointmentValueCents(row: {
  priceCents: number | null;
}): number {
  if (row.priceCents == null || !Number.isFinite(row.priceCents) || row.priceCents < 0) {
    return 0;
  }
  return row.priceCents;
}

export function isCashVisitKind(visitKind: AppointmentVisitKind): boolean {
  return (
    visitKind === AppointmentVisitKind.UNIQUE_CONSULTATION ||
    visitKind === AppointmentVisitKind.RETURN
  );
}

export function isPlanVisitKind(visitKind: AppointmentVisitKind): boolean {
  return visitKind === AppointmentVisitKind.TREATMENT_PLAN;
}

export function buildAgendaFinanceProjection(
  rows: AgendaProjectionAppointmentRow[],
  weekStartLocal: DateTime,
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): AgendaFinanceProjection {
  const tz = timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const weekDays = Array.from({ length: 7 }, (_, i) => weekStartLocal.plus({ days: i }));

  const byDayMap = new Map<string, AgendaFinanceProjectionDay>();
  for (const day of weekDays) {
    const iso = day.toISODate()!;
    byDayMap.set(iso, {
      dateIso: iso,
      label: day.toFormat("ccc dd/LL"),
      scheduledCashCents: 0,
      completedCashCents: 0,
      planScheduledCount: 0,
      planCompletedCount: 0,
      appointmentCount: 0,
    });
  }

  let scheduledCashCents = 0;
  let scheduledCashCount = 0;
  let completedCashCents = 0;
  let completedCashCount = 0;
  let planScheduledCount = 0;
  let planScheduledValueCents = 0;
  let planCompletedCount = 0;
  let planCompletedValueCents = 0;
  let pendingConfirmationCount = 0;

  for (const row of rows) {
    if (row.status === AppointmentStatus.CANCELLED || row.status === AppointmentStatus.NO_SHOW) continue;

    const localDate = DateTime.fromJSDate(row.startAt, { zone: "utc" }).setZone(tz).toISODate();
    const dayBucket = localDate ? byDayMap.get(localDate) : undefined;
    if (dayBucket) {
      dayBucket.appointmentCount += 1;
    }

    const valueCents = resolveAppointmentValueCents(row);

    if (
      row.status === AppointmentStatus.SCHEDULED &&
      row.confirmationStatus === AppointmentConfirmationStatus.PENDING_CONFIRMATION
    ) {
      pendingConfirmationCount += 1;
    }

    if (isCashVisitKind(row.visitKind)) {
      if (row.status === AppointmentStatus.SCHEDULED) {
        scheduledCashCents += valueCents;
        scheduledCashCount += 1;
        if (dayBucket) dayBucket.scheduledCashCents += valueCents;
      } else if (row.status === AppointmentStatus.COMPLETED) {
        completedCashCents += valueCents;
        completedCashCount += 1;
        if (dayBucket) dayBucket.completedCashCents += valueCents;
      }
    } else if (isPlanVisitKind(row.visitKind)) {
      if (row.status === AppointmentStatus.SCHEDULED) {
        planScheduledCount += 1;
        planScheduledValueCents += valueCents;
        if (dayBucket) dayBucket.planScheduledCount += 1;
      } else if (row.status === AppointmentStatus.COMPLETED) {
        planCompletedCount += 1;
        planCompletedValueCents += valueCents;
        if (dayBucket) dayBucket.planCompletedCount += 1;
      }
    }
  }

  return {
    scheduledCashCents,
    scheduledCashCount,
    completedCashCents,
    completedCashCount,
    planScheduledCount,
    planScheduledValueCents,
    planCompletedCount,
    planCompletedValueCents,
    pendingConfirmationCount,
    weekTotalCashCents: scheduledCashCents + completedCashCents,
    byDay: weekDays.map((d) => byDayMap.get(d.toISODate()!)!),
  };
}
