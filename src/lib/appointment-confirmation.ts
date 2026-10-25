import { AppointmentConfirmationStatus } from "@prisma/client";
import type { AppointmentConfirmationStatusValue } from "@/lib/appointment-fields-schema";

export const CONFIRMATION_STATUS_LABELS: Record<AppointmentConfirmationStatus, string> = {
  PENDING_CONFIRMATION: "Falta confirmar",
  CONFIRMED: "Confirmado",
};

export type ConfirmationStatusGuess = "PENDING_CONFIRMATION" | "CONFIRMED" | null | undefined;

function confirmationStatusKey(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
): "CONFIRMED" | "PENDING_CONFIRMATION" {
  const key = String(status);
  return key === AppointmentConfirmationStatus.CONFIRMED ? "CONFIRMED" : "PENDING_CONFIRMATION";
}

export function resolveConfirmationStatusFromGuess(
  guess: ConfirmationStatusGuess,
): AppointmentConfirmationStatus {
  if (guess === AppointmentConfirmationStatus.CONFIRMED) {
    return AppointmentConfirmationStatus.CONFIRMED;
  }
  return AppointmentConfirmationStatus.PENDING_CONFIRMATION;
}

/** Fundo + contorno — cards de lista (semana/lista), não a grade Schedule-X. */
export function appointmentCardSurfaceClasses(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
  colorsEnabled: boolean,
): string {
  if (!colorsEnabled) {
    return "bg-muted";
  }
  if (confirmationStatusKey(status) === "CONFIRMED") {
    return "bg-success/15 border border-success/30 dark:bg-success/20 dark:border-success";
  }
  return "bg-warning/15 border border-warning/30 dark:bg-warning/20 dark:border-warning";
}

/** Só preenchimento — eventos da grade (sem anel/borda; só a barra lateral colorida). */
export function appointmentGridFillClasses(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
  colorsEnabled: boolean,
): string {
  if (!colorsEnabled) {
    return "bg-muted";
  }
  if (confirmationStatusKey(status) === "CONFIRMED") {
    return "bg-success/15 dark:bg-success/20";
  }
  return "bg-warning/15 dark:bg-warning/20";
}

export function confirmationBadgeClasses(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
): string {
  if (confirmationStatusKey(status) === "CONFIRMED") {
    return "border-success/50 text-success dark:border-success dark:text-success dark:bg-success/20";
  }
  return "border-warning/50 text-warning dark:border-warning dark:text-warning dark:bg-warning/20";
}

export function formatConfirmationStatusLabel(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
): string {
  if (confirmationStatusKey(status) === "CONFIRMED") {
    return CONFIRMATION_STATUS_LABELS.CONFIRMED;
  }
  return CONFIRMATION_STATUS_LABELS.PENDING_CONFIRMATION;
}

export function isPendingConfirmation(
  status: AppointmentConfirmationStatus | AppointmentConfirmationStatusValue,
): boolean {
  return confirmationStatusKey(status) === "PENDING_CONFIRMATION";
}
