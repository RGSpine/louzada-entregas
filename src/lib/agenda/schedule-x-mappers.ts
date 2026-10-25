import { DateTime } from "luxon";
// Import de valor: fornece o Temporal em runtime (polyfill) e o namespace de tipo.
// O `@schedule-x/calendar` espera o Temporal global; este import cobre nosso uso direto.
import { Temporal } from "temporal-polyfill";
import type { CalendarEventExternal } from "@schedule-x/calendar";
import type { AgendaWeekAppointmentItem } from "@/components/dashboard/AgendaWeekAppointmentCard";

export type AgendaCalendarAppointment = AgendaWeekAppointmentItem & {
  notes: string | null;
  patientServiceSessionId: string | null;
};

// O `@schedule-x/calendar` declara `DateRange` internamente (core.d.ts) mas não o exporta.
// Replicamos o shape usado pelo callback `onRangeUpdate`: start/end podem ser
// ZonedDateTime (visões semana/dia) ou PlainDate (visão mês).
export type ScheduleXDateRange = {
  start: Temporal.ZonedDateTime | Temporal.PlainDate;
  end: Temporal.ZonedDateTime | Temporal.PlainDate;
};

function luxonToZonedDateTime(dt: DateTime, timeZone: string): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from({
    timeZone,
    year: dt.year,
    month: dt.month,
    day: dt.day,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second,
    millisecond: 0,
  });
}

export function appointmentToCalendarEvent(
  appointment: AgendaCalendarAppointment,
  timeZone: string,
): CalendarEventExternal {
  const start = DateTime.fromJSDate(appointment.startAt, { zone: "utc" }).setZone(timeZone);
  const end = DateTime.fromJSDate(appointment.endAt, { zone: "utc" }).setZone(timeZone);
  if (!start.isValid || !end.isValid) {
    throw new Error(`Datas inválidas na marcação ${appointment.id}`);
  }
  const timeLabel = start.toFormat("HH:mm");

  return {
    id: appointment.id,
    title: `${timeLabel} · ${appointment.patientName}`,
    start: luxonToZonedDateTime(start, timeZone),
    end: luxonToZonedDateTime(end, timeZone),
    calendarId: "appointment",
    _options: {
      disableDND: appointment.status === "CANCELLED" || appointment.status === "NO_SHOW",
      disableResize: appointment.status === "CANCELLED" || appointment.status === "NO_SHOW" || appointment.status === "COMPLETED",
    },
    _patientAgendaColor: appointment.patientAgendaColor,
    _professionalColor: appointment.professionalColor ?? undefined,
    _serviceSpaceColor: appointment.serviceSpaceColor ?? undefined,
    _serviceSpaceName: appointment.serviceSpaceName ?? undefined,
    _status: appointment.status,
    _confirmationStatus: appointment.confirmationStatus,
  };
}

export function zonedDateTimeToFormSlot(
  dateTime: Temporal.ZonedDateTime,
  timeZone: string,
): { dateValue: string; timeValue: string } {
  const dt = DateTime.fromObject(
    {
      year: dateTime.year,
      month: dateTime.month,
      day: dateTime.day,
      hour: dateTime.hour,
      minute: dateTime.minute,
    },
    { zone: timeZone },
  );
  return {
    dateValue: dt.toFormat("yyyy-LL-dd"),
    timeValue: dt.toFormat("HH:mm"),
  };
}

export function plainDateToIso(date: Temporal.PlainDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
