import { google, type calendar_v3 } from "googleapis";
import { AppointmentStatus, AppointmentVisitKind, AppointmentCareSetting } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DateTime } from "luxon";
import { isGoogleCalendarIntegrationEnabledForUser } from "@/lib/google-calendar-access";
import {
  buildGoogleCalendarDescription,
  buildGoogleEventSummary,
  buildGoogleExtendedProperties,
} from "@/lib/appointment-visit-meta";
import {
  GOOGLE_OAUTH_REQUESTED_SCOPES,
  scopeIncludesGoogleCalendar,
} from "@/lib/google-oauth-link";
import {
  GOOGLE_OAUTH_REVOKED_MESSAGE,
  handleGoogleOAuthRevoked,
  invalidateGoogleOAuthAccount,
  isGoogleOAuthRevokedError,
} from "@/lib/google-oauth-tokens";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const PRIMARY_CALENDAR_ID = "primary";

export type GoogleCalendarSyncAction = "insert" | "update" | "delete" | "skip";

export type GoogleCalendarSyncResult = {
  synced: boolean;
  action?: GoogleCalendarSyncAction;
  eventId?: string;
  reason?: string;
};

function getOAuthClient() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET não configurados.");
  }
  return new google.auth.OAuth2(clientId, clientSecret);
}

async function getGoogleAccountForUser(userId: string) {
  return prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      access_token: true,
      refresh_token: true,
      expires_at: true,
      scope: true,
    },
  });
}

export async function getAuthorizedGoogleCalendarClient(userId: string) {
  const account = await getGoogleAccountForUser(userId);
  if (!account?.refresh_token && !account?.access_token) {
    return null;
  }

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await prisma.account.updateMany({
      where: { userId, provider: "google" },
      data: {
        access_token: tokens.access_token,
        expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      },
    });
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

export type GoogleCalendarConnectionStatus = {
  connected: boolean;
  hasCalendarScope: boolean;
  needsReconnect: boolean;
  message: string;
};

function getStoredGoogleCalendarConnectionStatus(account: {
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
} | null): GoogleCalendarConnectionStatus {
  if (!account?.refresh_token && !account?.access_token) {
    return {
      connected: false,
      hasCalendarScope: false,
      needsReconnect: false,
      message: "Conecte a conta Google para sincronizar a agenda.",
    };
  }
  const scope = account.scope ?? "";
  const hasCalendarScope = scopeIncludesGoogleCalendar(scope);
  return {
    connected: true,
    hasCalendarScope,
    needsReconnect: false,
    message: hasCalendarScope
      ? "Google Agenda ligado — marcações sincronizam com o calendário."
      : "Conta Google ligada, mas falta permissão de Calendar. Reconecte.",
  };
}

export async function getGoogleCalendarConnectionStatus(
  userId: string,
): Promise<GoogleCalendarConnectionStatus> {
  const account = await getGoogleAccountForUser(userId);
  return getStoredGoogleCalendarConnectionStatus(account);
}

/** Valida tokens com a API Google; limpa tokens se o utilizador revogou o acesso. */
export async function verifyGoogleCalendarTokensActive(userId: string): Promise<boolean> {
  const account = await getGoogleAccountForUser(userId);
  if (!account?.refresh_token && !account?.access_token) return false;

  const calendar = await getAuthorizedGoogleCalendarClient(userId);
  if (!calendar) {
    await invalidateGoogleOAuthAccount(userId);
    return false;
  }

  try {
    await calendar.events.list({
      calendarId: PRIMARY_CALENDAR_ID,
      maxResults: 1,
      timeMin: new Date().toISOString(),
      singleEvents: true,
    });
    return true;
  } catch (err) {
    if (await handleGoogleOAuthRevoked(userId, err)) return false;
    if (isGoogleOAuthRevokedError(err)) return false;
    throw err;
  }
}

async function persistGoogleCalendarScope(userId: string): Promise<void> {
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: { scope: GOOGLE_OAUTH_REQUESTED_SCOPES },
  });
}

/** Estado persistido + verificação em tempo real (revogação em myaccount.google.com). */
export async function resolveGoogleCalendarConnectionStatus(
  userId: string,
): Promise<GoogleCalendarConnectionStatus> {
  const account = await getGoogleAccountForUser(userId);
  const stored = getStoredGoogleCalendarConnectionStatus(account);

  if (!stored.connected) return stored;

  // Tokens existem — confirmar com a API (scope pode estar vazio após reconnect Auth.js).
  try {
    const valid = await verifyGoogleCalendarTokensActive(userId);
    if (valid) {
      if (!scopeIncludesGoogleCalendar(account?.scope)) {
        await persistGoogleCalendarScope(userId);
      }
      return {
        connected: true,
        hasCalendarScope: true,
        needsReconnect: false,
        message: "Google Agenda ligado — marcações sincronizam com o calendário.",
      };
    }
  } catch {
    // Falha transitória — confiar no scope guardado se existir.
    if (stored.hasCalendarScope) return stored;
  }

  if (!stored.hasCalendarScope) {
    return {
      connected: true,
      hasCalendarScope: false,
      needsReconnect: false,
      message: "Conta Google ligada, mas falta permissão de Calendar. Reconecte.",
    };
  }

  return {
    connected: false,
    hasCalendarScope: false,
    needsReconnect: true,
    message: GOOGLE_OAUTH_REVOKED_MESSAGE,
  };
}

export function parseGoogleEventUpdated(updated?: string | null): Date | null {
  if (!updated) return null;
  const d = new Date(updated);
  return Number.isNaN(d.getTime()) ? null : d;
}

type AppointmentRow = {
  id: string;
  status: AppointmentStatus;
  startAt: Date;
  endAt: Date;
  timezoneAtBooking: string;
  title: string | null;
  visitKind: AppointmentVisitKind;
  careSetting: AppointmentCareSetting;
  notes: string | null;
  googleCalendarEventId: string | null;
  patient: { name: string };
};

function buildEventRequestBody(appointment: AppointmentRow): calendar_v3.Schema$Event {
  const tz = appointment.timezoneAtBooking || "America/Sao_Paulo";
  const start = DateTime.fromJSDate(appointment.startAt, { zone: "utc" }).setZone(tz);
  const end = DateTime.fromJSDate(appointment.endAt, { zone: "utc" }).setZone(tz);
  const summary = buildGoogleEventSummary({
    patientName: appointment.patient.name,
    title: appointment.title,
    visitKind: appointment.visitKind,
  });

  // Google Calendar: dateTime local + timeZone (sem offset no string evita ambiguidade).
  const dateTimeFmt = "yyyy-MM-dd'T'HH:mm:ss";
  return {
    summary,
    description: buildGoogleCalendarDescription({
      visitKind: appointment.visitKind,
      careSetting: appointment.careSetting,
      notes: appointment.notes,
      status: appointment.status,
    }),
    extendedProperties: buildGoogleExtendedProperties({
      visitKind: appointment.visitKind,
      careSetting: appointment.careSetting,
    }),
    start: { dateTime: start.toFormat(dateTimeFmt), timeZone: tz },
    end: { dateTime: end.toFormat(dateTimeFmt), timeZone: tz },
  };
}

function isGoogleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: number }).code;
  const status = (err as { response?: { status?: number } }).response?.status;
  return code === 404 || status === 404 || status === 410;
}

/**
 * Remove o evento Google ligado à marcação, sem exigir status CANCELLED.
 * Usado na exclusão hard: tenta limpar o Calendar quando há OAuth + escopo;
 * se a integração estiver ausente/sem permissão, limpa só o vínculo local e
 * devolve skip — a exclusão no Prisma segue (agenda interna = fonte de verdade).
 */
export async function unlinkGoogleCalendarEventForAppointment(
  userId: string,
  appointmentId: string,
): Promise<GoogleCalendarSyncResult> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, professionalUserId: userId },
    select: { id: true, googleCalendarEventId: true },
  });
  if (!appointment) {
    // Sem linha no Prisma deste profissional: não há vínculo local a limpar.
    // clearLocalLink() aqui falharia (P2025) ou, pior, atualizaria por id sem
    // filtrar professionalUserId. Evento órfão no Google (se houver) fica fora
    // do nosso DB — aceitável no best-effort.
    return {
      synced: true,
      action: "skip",
      reason: "Marcação não encontrada (já removida ou inacessível).",
    };
  }
  if (!appointment.googleCalendarEventId) {
    return { synced: true, action: "skip", reason: "Sem evento Google." };
  }

  const clearLocalLink = async () => {
    // Mesmo filtro do findFirst: nunca zerar vínculo de outra conta por id só.
    await prisma.appointment.updateMany({
      where: { id: appointmentId, professionalUserId: userId },
      data: { googleCalendarEventId: null, googleCalendarUpdatedAt: null },
    });
  };

  if (!(await isGoogleCalendarIntegrationEnabledForUser(userId))) {
    await clearLocalLink();
    return {
      synced: true,
      action: "skip",
      reason: "Integração Google Agenda indisponível — vínculo local limpo.",
    };
  }

  const status = await getGoogleCalendarConnectionStatus(userId);
  if (!status.connected || !status.hasCalendarScope) {
    await clearLocalLink();
    return {
      synced: true,
      action: "skip",
      reason: `${status.message} Vínculo local limpo; exclusão no sistema segue.`,
    };
  }

  const calendar = await getAuthorizedGoogleCalendarClient(userId);
  if (!calendar) {
    await clearLocalLink();
    return {
      synced: true,
      action: "skip",
      reason: `${GOOGLE_OAUTH_REVOKED_MESSAGE} Vínculo local limpo; exclusão no sistema segue.`,
    };
  }

  try {
    try {
      await calendar.events.delete({
        calendarId: PRIMARY_CALENDAR_ID,
        eventId: appointment.googleCalendarEventId,
      });
    } catch (err) {
      if (!isGoogleNotFoundError(err)) {
        throw err;
      }
    }
    await clearLocalLink();
    return { synced: true, action: "delete" };
  } catch (err) {
    if (await handleGoogleOAuthRevoked(userId, err)) {
      await clearLocalLink();
      return {
        synced: true,
        action: "skip",
        reason: `${GOOGLE_OAUTH_REVOKED_MESSAGE} Vínculo local limpo; exclusão no sistema segue.`,
      };
    }
    // API Google falhou (rede/quota/etc.): não bloqueia a exclusão local.
    await clearLocalLink();
    return {
      synced: true,
      action: "skip",
      reason:
        err instanceof Error
          ? `Google Calendar indisponível (${err.message}). Vínculo local limpo.`
          : "Google Calendar indisponível. Vínculo local limpo.",
    };
  }
}

/**
 * Sincroniza uma marcação com o Google Calendar (criar, atualizar ou apagar).
 */
export async function syncAppointmentWithGoogleCalendar(
  userId: string,
  appointmentId: string,
): Promise<GoogleCalendarSyncResult> {
  if (!(await isGoogleCalendarIntegrationEnabledForUser(userId))) {
    return { synced: false, action: "skip", reason: "Integração Google Agenda indisponível para esta conta." };
  }

  const status = await getGoogleCalendarConnectionStatus(userId);
  if (!status.connected || !status.hasCalendarScope) {
    return { synced: false, reason: status.message };
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, professionalUserId: userId },
    include: { patient: { select: { name: true } } },
  });
  if (!appointment) {
    return { synced: false, reason: "Marcação não encontrada." };
  }

  const calendar = await getAuthorizedGoogleCalendarClient(userId);
  if (!calendar) {
    return { synced: false, reason: GOOGLE_OAUTH_REVOKED_MESSAGE };
  }

  try {
  if (
    appointment.status === AppointmentStatus.CANCELLED ||
    appointment.status === AppointmentStatus.NO_SHOW
  ) {
    if (!appointment.googleCalendarEventId) {
      return { synced: true, action: "skip", reason: "Sem evento Google." };
    }
    try {
      await calendar.events.delete({
        calendarId: PRIMARY_CALENDAR_ID,
        eventId: appointment.googleCalendarEventId,
      });
    } catch (err) {
      if (!isGoogleNotFoundError(err)) {
        throw err;
      }
    }
    await prisma.appointment.updateMany({
      where: { id: appointmentId, professionalUserId: userId },
      data: { googleCalendarEventId: null, googleCalendarUpdatedAt: null },
    });
    return { synced: true, action: "delete" };
  }

  const body = buildEventRequestBody(appointment);

  if (appointment.googleCalendarEventId) {
    try {
      const res = await calendar.events.update({
        calendarId: PRIMARY_CALENDAR_ID,
        eventId: appointment.googleCalendarEventId,
        requestBody: body,
      });
      const googleUpdated = parseGoogleEventUpdated(res.data.updated);
      await prisma.appointment.updateMany({
        where: { id: appointmentId, professionalUserId: userId },
        data: { googleCalendarUpdatedAt: googleUpdated ?? undefined },
      });
      return {
        synced: true,
        action: "update",
        eventId: appointment.googleCalendarEventId,
      };
    } catch (err) {
      if (!isGoogleNotFoundError(err)) {
        throw err;
      }
      await prisma.appointment.updateMany({
        where: { id: appointmentId, professionalUserId: userId },
        data: { googleCalendarEventId: null, googleCalendarUpdatedAt: null },
      });
    }
  }

  const res = await calendar.events.insert({
    calendarId: PRIMARY_CALENDAR_ID,
    requestBody: body,
  });

  const eventId = res.data.id;
  const googleUpdated = parseGoogleEventUpdated(res.data.updated);
  if (eventId) {
    await prisma.appointment.updateMany({
      where: { id: appointmentId, professionalUserId: userId },
      data: {
        googleCalendarEventId: eventId,
        googleCalendarUpdatedAt: googleUpdated ?? undefined,
      },
    });
  }

  return { synced: true, action: "insert", eventId: eventId ?? undefined };
  } catch (err) {
    if (await handleGoogleOAuthRevoked(userId, err)) {
      return { synced: false, reason: GOOGLE_OAUTH_REVOKED_MESSAGE };
    }
    throw err;
  }
}

/** @deprecated Use syncAppointmentWithGoogleCalendar */
export async function tryPushAppointmentToGoogleCalendar(
  userId: string,
  appointmentId: string,
): Promise<{ pushed: boolean; eventId?: string; reason?: string }> {
  const result = await syncAppointmentWithGoogleCalendar(userId, appointmentId);
  return {
    pushed: result.synced && result.action !== "skip",
    eventId: result.eventId,
    reason: result.reason,
  };
}

export function getGoogleCalendarConnectPath(): string {
  return "/api/integrations/google/connect";
}

export { CALENDAR_SCOPE, PRIMARY_CALENDAR_ID };
