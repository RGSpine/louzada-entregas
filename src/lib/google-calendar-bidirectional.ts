import { AppointmentStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { importEventsFromGoogleCalendar } from "@/lib/google-calendar-import";
import {
  getGoogleCalendarConnectionStatus,
  syncAppointmentWithGoogleCalendar,
} from "@/lib/google-calendar-sync";
import {
  canUseGoogleCalendarIntegration,
  isGoogleCalendarIntegrationEnabledForUser,
} from "@/lib/google-calendar-access";

export type BidirectionalSyncResult = {
  userId: string;
  import: Awaited<ReturnType<typeof importEventsFromGoogleCalendar>>;
  pushed: number;
  pushFailed: number;
  skipped: boolean;
  reason?: string;
};

const SYNC_DAYS_BACK = 7;
const SYNC_DAYS_FORWARD = 90;

/**
 * Sync automático: importa do Google, depois envia alterações locais (Louzada Entregas → Google).
 */
export async function runGoogleCalendarBidirectionalSync(
  userId: string,
): Promise<BidirectionalSyncResult> {
  if (!(await isGoogleCalendarIntegrationEnabledForUser(userId))) {
    return {
      userId,
      import: { imported: 0, updated: 0, skipped: 0, cancelled: 0, errors: [] },
      pushed: 0,
      pushFailed: 0,
      skipped: true,
      reason: "Integração Google Agenda indisponível para esta conta.",
    };
  }

  const conn = await getGoogleCalendarConnectionStatus(userId);
  if (!conn.connected || !conn.hasCalendarScope) {
    return {
      userId,
      import: { imported: 0, updated: 0, skipped: 0, cancelled: 0, errors: [conn.message] },
      pushed: 0,
      pushFailed: 0,
      skipped: true,
      reason: conn.message,
    };
  }

  const importResult = await importEventsFromGoogleCalendar(userId, {
    daysBack: SYNC_DAYS_BACK,
    daysForward: SYNC_DAYS_FORWARD,
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleCalendarLastSyncedAt: true },
  });

  const since =
    user?.googleCalendarLastSyncedAt ??
    DateTime.now().minus({ days: SYNC_DAYS_BACK }).toJSDate();

  const now = DateTime.now().setZone(DEFAULT_SCHEDULE_TIMEZONE);
  const rangeStart = now.minus({ days: SYNC_DAYS_BACK }).startOf("day").toUTC().toJSDate();
  const rangeEnd = now.plus({ days: SYNC_DAYS_FORWARD }).endOf("day").toUTC().toJSDate();

  const toSync = await prisma.appointment.findMany({
    where: {
      professionalUserId: userId,
      startAt: { lt: rangeEnd },
      endAt: { gt: rangeStart },
      OR: [
        { updatedAt: { gt: since } },
        { googleCalendarEventId: null, status: { not: AppointmentStatus.CANCELLED } },
      ],
    },
    select: { id: true },
  });

  let pushed = 0;
  let pushFailed = 0;

  for (const row of toSync) {
    try {
      const res = await syncAppointmentWithGoogleCalendar(userId, row.id);
      if (res.synced && res.action !== "skip") {
        pushed += 1;
      }
    } catch {
      pushFailed += 1;
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { googleCalendarLastSyncedAt: new Date() },
  });

  return {
    userId,
    import: importResult,
    pushed,
    pushFailed,
    skipped: false,
  };
}

export async function listUsersWithGoogleCalendarLinked(): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: {
      provider: "google",
      OR: [{ refresh_token: { not: null } }, { access_token: { not: null } }],
    },
    select: {
      userId: true,
      scope: true,
      user: {
        select: { email: true, googleCalendarManualApprovedAt: true },
      },
    },
  });

  return [
    ...new Set(
      accounts
        .filter(
          (a) =>
            (a.scope ?? "").includes("calendar") &&
            canUseGoogleCalendarIntegration(a.user.email, {
              googleCalendarManualApprovedAt: a.user.googleCalendarManualApprovedAt,
            }),
        )
        .map((a) => a.userId),
    ),
  ];
}

export async function runBidirectionalSyncForAllLinkedUsers(): Promise<{
  processed: number;
  results: BidirectionalSyncResult[];
}> {
  const userIds = await listUsersWithGoogleCalendarLinked();
  const results: BidirectionalSyncResult[] = [];

  for (const userId of userIds) {
    results.push(await runGoogleCalendarBidirectionalSync(userId));
  }

  return { processed: userIds.length, results };
}
