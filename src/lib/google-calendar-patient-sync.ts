import { google, type calendar_v3 } from "googleapis";
import { AppointmentStatus, AppointmentVisitKind, AppointmentCareSetting } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  buildGoogleCalendarDescription,
  buildGoogleEventSummary,
  buildGoogleExtendedProperties,
} from "@/lib/appointment-visit-meta";
import { parseGoogleEventUpdated } from "@/lib/google-calendar-sync";
import { scopeIncludesGoogleCalendar } from "@/lib/google-oauth-link";
import { logger } from "@/lib/logger";

const PRIMARY_CALENDAR_ID = "primary";

type PatientCalendarAccount = {
  patientId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
};

function getOAuthClient() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret);
}

async function calendarForAccount(account: PatientCalendarAccount) {
  const oauth2 = getOAuthClient();
  if (!oauth2) return null;
  if (!account.refreshToken && !account.accessToken) return null;
  oauth2.setCredentials({
    access_token: account.accessToken ?? undefined,
    refresh_token: account.refreshToken ?? undefined,
    expiry_date: account.expiresAt ? account.expiresAt * 1000 : undefined,
  });
  oauth2.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await prisma.patientGoogleCalendarAccount.updateMany({
      where: { patientId: account.patientId },
      data: {
        accessToken: tokens.access_token,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      },
    });
  });
  return google.calendar({ version: "v3", auth: oauth2 });
}

/**
 * Conta Google do paciente da marcação, ou da conta B2C com o mesmo e-mail
 * (a ficha clínica do profissional é outra linha Patient).
 */
export async function resolvePatientGoogleAccount(patient: {
  id: string;
  email: string | null;
}): Promise<PatientCalendarAccount | null> {
  const direct = await prisma.patientGoogleCalendarAccount.findUnique({
    where: { patientId: patient.id },
  });
  if (direct?.refreshToken || direct?.accessToken) {
    return {
      patientId: direct.patientId,
      accessToken: direct.accessToken,
      refreshToken: direct.refreshToken,
      expiresAt: direct.expiresAt,
      scope: direct.scope,
    };
  }

  const email = patient.email?.trim().toLowerCase();
  if (!email) return null;

  const b2c = await prisma.patient.findFirst({
    where: {
      authUserId: { not: null },
      email: { equals: email, mode: "insensitive" },
      googleCalendarAccount: { isNot: null },
    },
    select: {
      googleCalendarAccount: true,
    },
  });
  const account = b2c?.googleCalendarAccount;
  if (!account?.refreshToken && !account?.accessToken) return null;
  if (!scopeIncludesGoogleCalendar(account.scope) && account.scope) return null;
  return {
    patientId: account.patientId,
    accessToken: account.accessToken,
    refreshToken: account.refreshToken,
    expiresAt: account.expiresAt,
    scope: account.scope,
  };
}

function patientEventBody(input: {
  professionalName: string;
  startAt: Date;
  endAt: Date;
  timezoneAtBooking: string;
  title: string | null;
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  notes: string | null;
  status: AppointmentStatus;
}): calendar_v3.Schema$Event {
  const tz = input.timezoneAtBooking || "America/Sao_Paulo";
  const start = DateTime.fromJSDate(input.startAt, { zone: "utc" }).setZone(tz);
  const end = DateTime.fromJSDate(input.endAt, { zone: "utc" }).setZone(tz);
  const who = sanitizeText(input.professionalName).slice(0, 120) || "Profissional";
  const summary =
    input.title?.trim() && !/^reserva pelo marketplace$/i.test(input.title.trim())
      ? sanitizeText(input.title).slice(0, 200)
      : buildGoogleEventSummary({
          patientName: who,
          title: null,
          visitKind: input.visitKind,
        });
  const dateTimeFmt = "yyyy-MM-dd'T'HH:mm:ss";
  return {
    summary,
    description: buildGoogleCalendarDescription({
      visitKind: input.visitKind,
      careSetting: input.careSetting,
      notes: input.notes,
      status: input.status,
    }),
    extendedProperties: buildGoogleExtendedProperties({
      visitKind: input.visitKind,
      careSetting: input.careSetting,
    }),
    start: { dateTime: start.toFormat(dateTimeFmt), timeZone: tz },
    end: { dateTime: end.toFormat(dateTimeFmt), timeZone: tz },
  };
}

function freesGoogleSlot(status: AppointmentStatus): boolean {
  return status === AppointmentStatus.CANCELLED || status === AppointmentStatus.NO_SHOW;
}

/**
 * Espelha a marcação na Google Agenda do paciente (criar, atualizar ou apagar).
 * Best-effort: ausência de conta Google não falha a agenda interna.
 */
export async function syncAppointmentWithPatientGoogleCalendar(
  appointmentId: string,
): Promise<{ synced: boolean; action?: string; reason?: string }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      timezoneAtBooking: true,
      title: true,
      visitKind: true,
      careSetting: true,
      notes: true,
      patientGoogleCalendarEventId: true,
      patient: { select: { id: true, email: true, name: true } },
      professional: { select: { name: true, email: true } },
    },
  });
  if (!appointment) return { synced: false, reason: "Marcação não encontrada." };

  const account = await resolvePatientGoogleAccount(appointment.patient);
  if (!account) {
    return { synced: true, action: "skip", reason: "Paciente sem Google Agenda." };
  }

  const calendar = await calendarForAccount(account);
  if (!calendar) {
    return { synced: false, reason: "OAuth Google do paciente indisponível." };
  }

  const clearLink = async () => {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        patientGoogleCalendarEventId: null,
        patientGoogleCalendarUpdatedAt: null,
      },
    });
  };

  try {
    if (freesGoogleSlot(appointment.status)) {
      if (!appointment.patientGoogleCalendarEventId) {
        return { synced: true, action: "skip" };
      }
      try {
        await calendar.events.delete({
          calendarId: PRIMARY_CALENDAR_ID,
          eventId: appointment.patientGoogleCalendarEventId,
        });
      } catch (err) {
        const status = (err as { code?: number; response?: { status?: number } }).response?.status;
        const code = (err as { code?: number }).code;
        if (code !== 404 && status !== 404 && status !== 410) throw err;
      }
      await clearLink();
      return { synced: true, action: "delete" };
    }

    const body = patientEventBody({
      professionalName:
        appointment.professional.name?.trim() ||
        appointment.professional.email ||
        "Profissional",
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      timezoneAtBooking: appointment.timezoneAtBooking,
      title: appointment.title,
      visitKind: appointment.visitKind,
      careSetting: appointment.careSetting,
      notes: appointment.notes,
      status: appointment.status,
    });

    if (appointment.patientGoogleCalendarEventId) {
      try {
        const res = await calendar.events.update({
          calendarId: PRIMARY_CALENDAR_ID,
          eventId: appointment.patientGoogleCalendarEventId,
          requestBody: body,
        });
        await prisma.appointment.update({
          where: { id: appointmentId },
          data: {
            patientGoogleCalendarUpdatedAt:
              parseGoogleEventUpdated(res.data.updated) ?? undefined,
          },
        });
        return { synced: true, action: "update" };
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        const code = (err as { code?: number }).code;
        if (code !== 404 && status !== 404 && status !== 410) throw err;
        await clearLink();
      }
    }

    const res = await calendar.events.insert({
      calendarId: PRIMARY_CALENDAR_ID,
      requestBody: body,
    });
    if (res.data.id) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          patientGoogleCalendarEventId: res.data.id,
          patientGoogleCalendarUpdatedAt: parseGoogleEventUpdated(res.data.updated) ?? undefined,
        },
      });
    }
    return { synced: true, action: "insert", reason: res.data.id };
  } catch (err) {
    logger.warn("Google Agenda do paciente falhou", {
      feature: "google-calendar-patient",
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      synced: false,
      reason: err instanceof Error ? err.message : "Falha ao sincronizar.",
    };
  }
}

/** Remove o evento na agenda do paciente antes de apagar a marcação no banco. */
export async function unlinkPatientGoogleCalendarEvent(
  appointmentId: string,
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      patientGoogleCalendarEventId: true,
      patient: { select: { id: true, email: true } },
    },
  });
  if (!appointment?.patientGoogleCalendarEventId) return;

  const account = await resolvePatientGoogleAccount(appointment.patient);
  if (!account) {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        patientGoogleCalendarEventId: null,
        patientGoogleCalendarUpdatedAt: null,
      },
    });
    return;
  }

  const calendar = await calendarForAccount(account);
  if (calendar) {
    try {
      await calendar.events.delete({
        calendarId: PRIMARY_CALENDAR_ID,
        eventId: appointment.patientGoogleCalendarEventId,
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const code = (err as { code?: number }).code;
      if (code !== 404 && status !== 404 && status !== 410) {
        logger.warn("Falha ao apagar evento na agenda do paciente", {
          feature: "google-calendar-patient",
          appointmentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      patientGoogleCalendarEventId: null,
      patientGoogleCalendarUpdatedAt: null,
    },
  });
}

/** Após conectar: envia marcações futuras já existentes para a agenda do paciente. */
export async function backfillPatientGoogleCalendar(b2cPatientId: string): Promise<number> {
  const patient = await prisma.patient.findUnique({
    where: { id: b2cPatientId },
    select: { id: true, email: true },
  });
  if (!patient?.email) return 0;

  const rows = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.SCHEDULED,
      startAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      patient: { email: { equals: patient.email, mode: "insensitive" } },
    },
    select: { id: true },
    take: 40,
  });

  let pushed = 0;
  for (const row of rows) {
    const res = await syncAppointmentWithPatientGoogleCalendar(row.id);
    if (res.synced && res.action !== "skip") pushed += 1;
  }
  return pushed;
}
