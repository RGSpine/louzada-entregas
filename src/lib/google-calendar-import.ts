import { AppointmentSource, AppointmentStatus } from "@prisma/client";
import { DateTime } from "luxon";
import type { calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { scheduleMarketplaceSlotSync } from "@/lib/marketplace/marketplace-sync";
import { sanitizeText } from "@/lib/sanitize";
import { findAppointmentOverlap } from "@/lib/appointment-availability";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  isAievoluiAgendaGoogleSummary,
  parseGoogleCalendarMetadata,
  parsePatientNameFromAievoluiSummary,
} from "@/lib/appointment-visit-meta";
import {
  getAuthorizedGoogleCalendarClient,
  getGoogleCalendarConnectionStatus,
  parseGoogleEventUpdated,
  PRIMARY_CALENDAR_ID,
} from "@/lib/google-calendar-sync";
import { isGoogleCalendarIntegrationEnabledForUser } from "@/lib/google-calendar-access";
import {
  GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME,
} from "@/lib/patient-clinical-scope";
import {
  GOOGLE_OAUTH_REVOKED_MESSAGE,
  handleGoogleOAuthRevoked,
} from "@/lib/google-oauth-tokens";

export const GOOGLE_IMPORT_FALLBACK_PATIENT_NAME = GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME;

const DEFAULT_DAYS_BACK = 7;
const DEFAULT_DAYS_FORWARD = 90;

export type GoogleCalendarImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  cancelled: number;
  errors: string[];
};

export function parsePatientNameFromGoogleSummary(summary?: string | null): string | null {
  const fromAievolui = parsePatientNameFromAievoluiSummary(summary);
  if (fromAievolui) return fromAievolui;
  if (!summary?.trim()) return null;
  const trimmed = summary.trim();
  return trimmed.length >= 2 ? trimmed : null;
}

function eventTimesToUtc(
  event: calendar_v3.Schema$Event,
  fallbackTz: string,
): { startAt: Date; endAt: Date; tz: string } | null {
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  if (!start || !end) {
    return null;
  }
  const tz = event.start?.timeZone || fallbackTz;
  const startDt = DateTime.fromISO(start, { setZone: true });
  const endDt = DateTime.fromISO(end, { setZone: true });
  if (!startDt.isValid || !endDt.isValid || endDt <= startDt) {
    return null;
  }
  return {
    startAt: startDt.toUTC().toJSDate(),
    endAt: endDt.toUTC().toJSDate(),
    tz,
  };
}

async function getOrCreateAgendaPlaceholderPatient(professionalUserId: string): Promise<string> {
  const existing = await prisma.patient.findFirst({
    where: {
      userId: professionalUserId,
      agendaOnly: true,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.patient.create({
    data: {
      name: GOOGLE_AGENDA_PLACEHOLDER_PATIENT_NAME,
      userId: professionalUserId,
      agendaOnly: true,
    },
    select: { id: true },
  });
  return created.id;
}

async function resolvePatientForGoogleEvent(
  professionalUserId: string,
  summary?: string | null,
): Promise<string> {
  if (isAievoluiAgendaGoogleSummary(summary)) {
    const guessed = parsePatientNameFromGoogleSummary(summary);
    if (guessed) {
      const name = sanitizeText(guessed);
      const clinical = await prisma.patient.findFirst({
        where: {
          userId: professionalUserId,
          agendaOnly: false,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (clinical) return clinical.id;
    }
  }

  return getOrCreateAgendaPlaceholderPatient(professionalUserId);
}

async function listGoogleEventsInRange(
  calendar: Awaited<ReturnType<typeof getAuthorizedGoogleCalendarClient>>,
  timeMin: Date,
  timeMax: Date,
): Promise<calendar_v3.Schema$Event[]> {
  if (!calendar) return [];

  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;

  do {
    const res = await calendar.events.list({
      calendarId: PRIMARY_CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return items;
}

/**
 * Importa eventos do Google Calendar para o Louzada Entregas.
 * Não sobrescreve marcações MANUAL/VOICE/OCR — apenas GOOGLE_SYNC ou cria novas.
 */
export async function importEventsFromGoogleCalendar(
  userId: string,
  options?: { daysBack?: number; daysForward?: number },
): Promise<GoogleCalendarImportResult> {
  const result: GoogleCalendarImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    cancelled: 0,
    errors: [],
  };

  if (!(await isGoogleCalendarIntegrationEnabledForUser(userId))) {
    result.errors.push("Integração Google Agenda indisponível para esta conta.");
    return result;
  }

  const conn = await getGoogleCalendarConnectionStatus(userId);
  if (!conn.connected || !conn.hasCalendarScope) {
    result.errors.push(conn.message);
    return result;
  }

  const calendar = await getAuthorizedGoogleCalendarClient(userId);
  if (!calendar) {
    result.errors.push("Sem tokens Google válidos.");
    return result;
  }

  const daysBack = options?.daysBack ?? DEFAULT_DAYS_BACK;
  const daysForward = options?.daysForward ?? DEFAULT_DAYS_FORWARD;
  const now = DateTime.now().setZone(DEFAULT_SCHEDULE_TIMEZONE);
  const timeMin = now.minus({ days: daysBack }).startOf("day").toUTC().toJSDate();
  const timeMax = now.plus({ days: daysForward }).endOf("day").toUTC().toJSDate();

  let events: calendar_v3.Schema$Event[];
  try {
    events = await listGoogleEventsInRange(calendar, timeMin, timeMax);
  } catch (e) {
    if (await handleGoogleOAuthRevoked(userId, e)) {
      result.errors.push(GOOGLE_OAUTH_REVOKED_MESSAGE);
      return result;
    }
    result.errors.push(e instanceof Error ? e.message : "Falha ao listar eventos Google.");
    return result;
  }

  const seenEventIds = new Set<string>();

  for (const event of events) {
    const eventId = event.id;
    if (!eventId) continue;
    seenEventIds.add(eventId);

    const googleUpdated = parseGoogleEventUpdated(event.updated);

    if (event.status === "cancelled") {
      const local = await prisma.appointment.findFirst({
        where: { professionalUserId: userId, googleCalendarEventId: eventId },
      });
      if (local && local.source === AppointmentSource.GOOGLE_SYNC) {
        if (local.status !== AppointmentStatus.CANCELLED) {
          await prisma.appointment.update({
            where: { id: local.id },
            data: {
              status: AppointmentStatus.CANCELLED,
              googleCalendarUpdatedAt: googleUpdated,
            },
          });
          result.cancelled += 1;
        }
      }
      continue;
    }

    const times = eventTimesToUtc(event, DEFAULT_SCHEDULE_TIMEZONE);
    if (!times) {
      result.skipped += 1;
      continue;
    }

    const existing = await prisma.appointment.findFirst({
      where: { professionalUserId: userId, googleCalendarEventId: eventId },
    });

    if (existing) {
      if (existing.source !== AppointmentSource.GOOGLE_SYNC) {
        result.skipped += 1;
        continue;
      }
      if (
        googleUpdated &&
        existing.googleCalendarUpdatedAt &&
        googleUpdated.getTime() <= existing.googleCalendarUpdatedAt.getTime()
      ) {
        result.skipped += 1;
        continue;
      }

      const overlap = await findAppointmentOverlap(userId, times.startAt, times.endAt, {
        excludeAppointmentId: existing.id,
      });
      if (overlap.overlapping) {
        result.skipped += 1;
        continue;
      }

      const title = event.summary?.trim() ? sanitizeText(event.summary.trim()) : null;
      const googleMeta = parseGoogleCalendarMetadata(event);
      const notes = googleMeta.notes ? sanitizeText(googleMeta.notes) : null;
      await prisma.appointment.update({
        where: { id: existing.id },
        data: {
          startAt: times.startAt,
          endAt: times.endAt,
          timezoneAtBooking: times.tz,
          title,
          visitKind: googleMeta.visitKind,
          careSetting: googleMeta.careSetting,
          notes,
          googleCalendarUpdatedAt: googleUpdated,
          status:
            existing.status === AppointmentStatus.CANCELLED
              ? AppointmentStatus.SCHEDULED
              : existing.status,
        },
      });
      result.updated += 1;
      continue;
    }

    const overlap = await findAppointmentOverlap(userId, times.startAt, times.endAt);
    if (overlap.overlapping) {
      result.skipped += 1;
      continue;
    }

    try {
      const patientId = await resolvePatientForGoogleEvent(userId, event.summary);
      const title = event.summary?.trim() ? sanitizeText(event.summary.trim()) : null;
      const googleMeta = parseGoogleCalendarMetadata(event);
      const notes = googleMeta.notes ? sanitizeText(googleMeta.notes) : null;

      await prisma.appointment.create({
        data: {
          professionalUserId: userId,
          patientId,
          startAt: times.startAt,
          endAt: times.endAt,
          timezoneAtBooking: times.tz,
          source: AppointmentSource.GOOGLE_SYNC,
          status: AppointmentStatus.SCHEDULED,
          title,
          visitKind: googleMeta.visitKind,
          careSetting: googleMeta.careSetting,
          notes,
          googleCalendarEventId: eventId,
          googleCalendarUpdatedAt: googleUpdated,
        },
      });
      result.imported += 1;
    } catch (e) {
      result.errors.push(
        e instanceof Error ? `Evento ${eventId}: ${e.message}` : `Evento ${eventId}: erro.`,
      );
    }
  }

  if (result.imported > 0 || result.updated > 0 || result.cancelled > 0) {
    scheduleMarketplaceSlotSync(userId);
  }

  return result;
}
