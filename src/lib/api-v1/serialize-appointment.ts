import type { SuggestedSlot } from "@/lib/appointment-suggested-slots";
import type { AppointmentListItem } from "@/server/services/appointments";

export function serializeAppointmentRow(row: AppointmentListItem) {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patientName,
    patientAgendaColor: row.patientAgendaColor,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
    title: row.title,
    timezoneAtBooking: row.timezoneAtBooking,
    source: row.source,
    visitKind: row.visitKind,
    careSetting: row.careSetting,
    priceCents: row.priceCents,
    notes: row.notes,
    serviceName: row.serviceName,
    hasFinanceIncome: row.hasFinanceIncome,
    confirmationStatus: row.confirmationStatus,
    evolutionId: row.evolutionId,
    hasEvolution: row.hasEvolution,
    noShowReason: row.noShowReason,
    recurrenceSeriesId: row.recurrenceSeriesId,
  };
}

export function serializeSuggestedSlots(slots: SuggestedSlot[] | undefined) {
  return (slots ?? []).map((s) => ({
    startAt: s.startUtc.toISOString(),
    endAt: s.endUtc.toISOString(),
    label: s.label,
  }));
}
