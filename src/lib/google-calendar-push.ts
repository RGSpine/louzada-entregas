import { after } from "next/server";
import { syncAppointmentWithGoogleCalendar } from "@/lib/google-calendar-sync";
import { syncAppointmentWithPatientGoogleCalendar } from "@/lib/google-calendar-patient-sync";
import { logger } from "@/lib/logger";

/**
 * Enfileira push ao Google Calendar do profissional e do paciente após a resposta HTTP.
 * Essencial no PWA/mobile: o cliente pode desconectar antes do fim do request.
 */
export function scheduleGoogleCalendarPush(userId: string, appointmentId: string): void {
  after(async () => {
    try {
      const result = await syncAppointmentWithGoogleCalendar(userId, appointmentId);
      if (!result.synced && result.action !== "skip") {
        logger.warn("Google Calendar push falhou", {
          feature: "google-calendar-push",
          userId,
          appointmentId,
          reason: result.reason,
        });
      }
    } catch (err) {
      logger.warn("Google Calendar push erro", {
        feature: "google-calendar-push",
        userId,
        appointmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const patient = await syncAppointmentWithPatientGoogleCalendar(appointmentId);
      if (!patient.synced && patient.action !== "skip") {
        logger.warn("Google Agenda do paciente falhou", {
          feature: "google-calendar-patient",
          appointmentId,
          reason: patient.reason,
        });
      }
    } catch (err) {
      logger.warn("Google Agenda do paciente erro", {
        feature: "google-calendar-patient",
        appointmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
