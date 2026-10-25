import { AppointmentStatus, AppointmentSource, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import {
  professionalActionsStoredSchema,
  type ProfessionalActionItem,
} from "@/lib/evolution-artifacts";
import { sendPushIfNotDelivered } from "@/lib/web-push/send";
import {
  actionItemDigestUrl,
  appointmentPushDisplayName,
  appointmentPushKind,
  appointmentReminderTitles,
  formatActionItemDigestBody,
  formatActionItemDigestTitle,
  formatAgendaDayDigestBody,
  formatAgendaDayDigestTitle,
  formatAppointmentReminderBody,
  type ActionDigestLine,
  type AppointmentLabelInput,
} from "@/lib/push-notifications/copy";

const SCHEDULE_TZ = "America/Sao_Paulo";

function pendingItems(stored: unknown): ProfessionalActionItem[] {
  const parsed = professionalActionsStoredSchema.safeParse(stored);
  if (!parsed.success) return [];
  return parsed.data.items.filter((i) => i.completed !== true);
}

function toLabelInput(appt: {
  source: AppointmentSource;
  title: string | null;
  visitKind?: AppointmentLabelInput["visitKind"];
  patient: { name: string; agendaOnly?: boolean };
}): AppointmentLabelInput {
  return {
    source: appt.source,
    title: appt.title,
    patientName: appt.patient.name,
    agendaOnly: appt.patient.agendaOnly,
    visitKind: appt.visitKind ?? null,
  };
}

async function summarizePendingActionItemsForUser(
  userId: string,
): Promise<ActionDigestLine[] | null> {
  const evolutions = await prisma.evolution.findMany({
    where: {
      professionalActions: { not: Prisma.DbNull },
      patient: { userId },
    },
    select: {
      professionalActions: true,
      patient: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  });

  const latestByPatient = new Map<string, (typeof evolutions)[number]>();
  for (const evo of evolutions) {
    if (!latestByPatient.has(evo.patient.id)) {
      latestByPatient.set(evo.patient.id, evo);
    }
  }

  const lines: ActionDigestLine[] = [];
  for (const evo of latestByPatient.values()) {
    const items = pendingItems(evo.professionalActions);
    if (items.length === 0) continue;
    lines.push({
      patientId: evo.patient.id,
      patientName: evo.patient.name,
      sampleLabel: items[0]!.label,
      count: items.length,
    });
  }

  if (lines.length === 0) return null;
  return lines;
}

async function dispatchActionItemDigestForUser(
  userId: string,
  dedupeKey: string,
  titleOverride?: string,
): Promise<boolean> {
  const lines = await summarizePendingActionItemsForUser(userId);
  if (!lines) return false;

  const title = titleOverride ?? formatActionItemDigestTitle(lines);
  const body = formatActionItemDigestBody(lines);

  return sendPushIfNotDelivered({
    userId,
    dedupeKey,
    kind: "action_item_digest",
    payload: {
      title,
      body: body.slice(0, 500),
      url: actionItemDigestUrl(lines),
      tag: `action-digest-${dedupeKey}`,
    },
  });
}

/**
 * Ao ativar push: notifica action points e consultas já existentes (uma vez por usuário).
 */
export async function dispatchUserPushBackfill(userId: string): Promise<{
  actionItems: boolean;
  appointments: boolean;
}> {
  const actionItems = await dispatchActionItemDigestForUser(
    userId,
    "action-item:backfill",
    "Você tem pontos de ação pendentes",
  );

  const now = DateTime.now().setZone(SCHEDULE_TZ);
  const upcoming = await prisma.appointment.findMany({
    where: {
      professionalUserId: userId,
      status: AppointmentStatus.SCHEDULED,
      startAt: {
        gte: now.toJSDate(),
        lte: now.plus({ days: 7 }).toJSDate(),
      },
    },
    select: {
      startAt: true,
      timezoneAtBooking: true,
      title: true,
      source: true,
      visitKind: true,
      patient: { select: { name: true, agendaOnly: true } },
    },
    orderBy: { startAt: "asc" },
    take: 20,
  });

  let appointments = false;
  if (upcoming.length > 0) {
    const next = upcoming[0]!;
    const tz = next.timezoneAtBooking || SCHEDULE_TZ;
    const start = DateTime.fromJSDate(next.startAt, { zone: tz });
    const timeLabel = start.toFormat("dd/MM 'às' HH:mm");
    const displayName = appointmentPushDisplayName(toLabelInput(next));
    const body =
      upcoming.length === 1
        ? formatAppointmentReminderBody({ displayName, timeLabel })
        : `Próxima: ${formatAppointmentReminderBody({ displayName, timeLabel })}. Mais ${upcoming.length - 1} nos próximos 7 dias.`;

    appointments = await sendPushIfNotDelivered({
      userId,
      dedupeKey: "appointment:backfill-summary",
      kind: "appointment_backfill",
      payload: {
        title: "Consultas agendadas",
        body: body.slice(0, 500),
        url: "/dashboard/agenda",
        tag: "appointment-backfill-summary",
      },
    });
  }

  return { actionItems, appointments };
}

/** Notifica imediatamente quando uma evolução gera novos action points. */
export async function notifyNewProfessionalActionsFromEvolution(input: {
  userId: string;
  evolutionId: string;
  patientId: string;
  patientName: string;
  professionalActions: unknown;
}): Promise<void> {
  const items = pendingItems(input.professionalActions);
  if (items.length === 0) return;

  const high = items.filter((i) => i.priority === "high").length;
  const title =
    items.length === 1
      ? `Novo ponto de ação — ${input.patientName}`
      : `${items.length} novos pontos de ação — ${input.patientName}`;

  const preview = items
    .slice(0, 2)
    .map((i) => i.label)
    .join(" · ");

  const body =
    high > 0
      ? `${preview} (${high} prioridade alta)`
      : preview;

  await sendPushIfNotDelivered({
    userId: input.userId,
    dedupeKey: `action-item:new:${input.evolutionId}`,
    kind: "action_item_new",
    payload: {
      title,
      body: body.slice(0, 500),
      url: `/dashboard/patients/${input.patientId}#evolucao-artifacts`,
      tag: `action-item-${input.evolutionId}`,
    },
  });
}

/**
 * Aviso (push) quando o plano do paciente chega a 2 ou 1 sessão restante.
 * Dedupe por compra + restante — Intra Users compartilham a conta do tenant.
 */
export async function notifyPackageNearEnd(input: {
  userId: string;
  purchaseId: string;
  patientId: string;
  patientName?: string | null;
  serviceName?: string | null;
  pendingRemaining: number;
  sessionCount: number;
}): Promise<boolean> {
  const { isPackageApproachingEnd, formatPackageNearEndWarning } = await import(
    "@/lib/finance/evolution-session-consumption"
  );
  if (
    !isPackageApproachingEnd({
      pendingRemaining: input.pendingRemaining,
      sessionCount: input.sessionCount,
    })
  ) {
    return false;
  }

  const body =
    formatPackageNearEndWarning({
      pendingRemaining: input.pendingRemaining,
      sessionCount: input.sessionCount,
      serviceName: input.serviceName ?? undefined,
      patientName: input.patientName ?? undefined,
    }) ??
    `Restam ${input.pendingRemaining} sessão(ões) no plano.`;

  const title =
    input.pendingRemaining === 1
      ? "Última sessão do plano"
      : "Plano perto do fim";

  return sendPushIfNotDelivered({
    userId: input.userId,
    dedupeKey: `package-ending:${input.purchaseId}:${input.pendingRemaining}`,
    kind: "package_near_end",
    payload: {
      title,
      body: body.slice(0, 500),
      url: `/dashboard/patients/${input.patientId}?tab=services`,
      tag: `package-ending-${input.purchaseId}-${input.pendingRemaining}`,
    },
  });
}

/** Dispara push se o summary pós-consumo indicar proximidade do fim. */
export async function maybeNotifyPackageNearEndFromConsumption(input: {
  userId: string;
  summary: {
    consumed?: boolean;
    purchaseId?: string;
    patientId?: string;
    patientName?: string;
    serviceName?: string;
    pendingRemaining?: number;
    sessionCount?: number;
  };
}): Promise<void> {
  const s = input.summary;
  if (
    !s.consumed ||
    !s.purchaseId ||
    !s.patientId ||
    s.pendingRemaining == null ||
    s.sessionCount == null
  ) {
    return;
  }
  await notifyPackageNearEnd({
    userId: input.userId,
    purchaseId: s.purchaseId,
    patientId: s.patientId,
    patientName: s.patientName,
    serviceName: s.serviceName,
    pendingRemaining: s.pendingRemaining,
    sessionCount: s.sessionCount,
  });
}

/** Resumo diário de action points pendentes (cron matinal). */
export async function dispatchDailyActionItemDigest(): Promise<number> {
  const todayKey = DateTime.now().setZone(SCHEDULE_TZ).toFormat("yyyy-MM-dd");

  const owners = await prisma.patient.findMany({
    where: {
      evolutions: {
        some: { professionalActions: { not: Prisma.DbNull } },
      },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  let dispatched = 0;
  for (const { userId } of owners) {
    if (!userId) continue;
    const sent = await dispatchActionItemDigestForUser(
      userId,
      `action-item:digest:${todayKey}`,
    );
    if (sent) dispatched += 1;
  }

  return dispatched;
}

/** Resumo matinal da agenda do dia civil (America/Sao_Paulo). */
export async function dispatchDailyAgendaDigest(): Promise<number> {
  const now = DateTime.now().setZone(SCHEDULE_TZ);
  const dayStart = now.startOf("day");
  const dayEnd = now.endOf("day");
  const todayKey = now.toFormat("yyyy-MM-dd");
  const dateParam = now.toFormat("yyyy-LL-dd");

  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.SCHEDULED,
      startAt: {
        gte: dayStart.toJSDate(),
        lte: dayEnd.toJSDate(),
      },
    },
    select: {
      startAt: true,
      timezoneAtBooking: true,
      title: true,
      source: true,
      visitKind: true,
      professionalUserId: true,
      patient: { select: { name: true, agendaOnly: true } },
    },
    orderBy: { startAt: "asc" },
  });

  const byUser = new Map<string, typeof appointments>();
  for (const appt of appointments) {
    const list = byUser.get(appt.professionalUserId) ?? [];
    list.push(appt);
    byUser.set(appt.professionalUserId, list);
  }

  let dispatched = 0;
  for (const [userId, rows] of byUser) {
    const lines = rows.map((appt) => {
      const tz = appt.timezoneAtBooking || SCHEDULE_TZ;
      const start = DateTime.fromJSDate(appt.startAt, { zone: tz });
      return {
        time: start.toFormat("HH:mm"),
        name: appointmentPushDisplayName(toLabelInput(appt)),
      };
    });

    const sent = await sendPushIfNotDelivered({
      userId,
      dedupeKey: `agenda:day:${todayKey}`,
      kind: "agenda_day_digest",
      payload: {
        title: formatAgendaDayDigestTitle(lines.length),
        body: formatAgendaDayDigestBody(lines).slice(0, 500),
        url: `/dashboard/agenda?date=${encodeURIComponent(dateParam)}`,
        tag: `agenda-day-${todayKey}`,
      },
    });
    if (sent) dispatched += 1;
  }

  return dispatched;
}

export async function dispatchAppointmentReminders(): Promise<number> {
  const now = DateTime.now().setZone(SCHEDULE_TZ);
  const windowEnd = now.plus({ hours: 25 });
  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.SCHEDULED,
      startAt: { gte: now.toJSDate(), lte: windowEnd.toJSDate() },
    },
    select: {
      id: true,
      startAt: true,
      title: true,
      source: true,
      visitKind: true,
      timezoneAtBooking: true,
      patient: { select: { name: true, agendaOnly: true } },
      professionalUserId: true,
    },
  });

  let dispatched = 0;

  for (const appt of appointments) {
    const tz = appt.timezoneAtBooking || SCHEDULE_TZ;
    const start = DateTime.fromJSDate(appt.startAt, { zone: tz });
    const minutesUntil = start.diff(now, "minutes").minutes;
    const label = toLabelInput(appt);
    const displayName = appointmentPushDisplayName(label);
    const kind = appointmentPushKind(label);
    const titles = appointmentReminderTitles(kind);
    const timeLabel = start.toFormat("dd/MM 'às' HH:mm");
    const baseUrl = `/dashboard/agenda`;

    const windows: {
      key: "24h" | "soon" | "1h";
      min: number;
      max: number;
      title: string;
      body: string;
    }[] = [
      {
        key: "24h",
        min: 23 * 60,
        max: 24 * 60 + 15,
        title: titles.dayBefore,
        body: formatAppointmentReminderBody({ displayName, timeLabel }),
      },
      {
        key: "soon",
        // Com cron externo a cada ~30 min: “em breve” = 2–4 h antes (evita spam cedo).
        min: 2 * 60,
        max: 4 * 60,
        title: titles.soon,
        body: formatAppointmentReminderBody({ displayName, timeLabel }),
      },
      {
        key: "1h",
        // Cron a cada ~30 min: janela ≥ intervalo (+ folga). 50–70 min (20) falhava entre runs.
        min: 45,
        max: 90,
        title: titles.oneHour,
        body: formatAppointmentReminderBody({
          displayName,
          timeLabel: start.toFormat("HH:mm"),
          timeOnly: true,
        }),
      },
    ];

    for (const w of windows) {
      if (minutesUntil < w.min || minutesUntil > w.max) continue;
      const sent = await sendPushIfNotDelivered({
        userId: appt.professionalUserId,
        dedupeKey: `appointment:${appt.id}:${w.key}`,
        kind: "appointment_reminder",
        payload: {
          title: w.title,
          body: w.body.slice(0, 500),
          url: baseUrl,
          tag: `appointment-${appt.id}-${w.key}`,
        },
      });
      if (sent) dispatched += 1;
    }
  }

  return dispatched;
}

export async function runPushNotificationDispatch(): Promise<{
  actionDigests: number;
  agendaDayDigests: number;
  appointmentReminders: number;
}> {
  const hourBrt = DateTime.now().setZone(SCHEDULE_TZ).hour;
  const isMorningDigest = hourBrt === 8;
  const actionDigests = isMorningDigest ? await dispatchDailyActionItemDigest() : 0;
  const agendaDayDigests = isMorningDigest ? await dispatchDailyAgendaDigest() : 0;
  const appointmentReminders = await dispatchAppointmentReminders();
  return { actionDigests, agendaDayDigests, appointmentReminders };
}
