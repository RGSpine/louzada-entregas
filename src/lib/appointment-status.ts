export const APPOINTMENT_STATUS_VALUES = [
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type AppointmentStatusValue = (typeof APPOINTMENT_STATUS_VALUES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatusValue, string> = {
  SCHEDULED: "Agendada",
  COMPLETED: "Realizada",
  CANCELLED: "Cancelada",
  NO_SHOW: "Faltou",
};

export function formatAppointmentStatusLabel(status: AppointmentStatusValue | string): string {
  if (status in APPOINTMENT_STATUS_LABELS) {
    return APPOINTMENT_STATUS_LABELS[status as AppointmentStatusValue];
  }
  return APPOINTMENT_STATUS_LABELS.SCHEDULED;
}

/** Cancelada e falta não ocupam o horário para novas marcações. */
export function appointmentFreesSlot(status: AppointmentStatusValue | string): boolean {
  return status === "CANCELLED" || status === "NO_SHOW";
}

export const APPOINTMENT_STATUSES_FREEING_SLOT: AppointmentStatusValue[] = [
  "CANCELLED",
  "NO_SHOW",
];
