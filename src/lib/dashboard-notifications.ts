import { AppointmentStatus, PatientServicePurchaseType, PatientServiceSessionStatus, ServiceBillingMode, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import {
  professionalActionsStoredSchema,
  type ProfessionalActionItem,
} from "@/lib/evolution-artifacts";
import {
  formatPackageNearEndWarning,
  isPackageApproachingEnd,
} from "@/lib/finance/evolution-session-consumption";
import {
  formatMonthlyMidPeriodWarning,
  isMonthlyPlanMidPeriod,
} from "@/lib/finance/service-billing-mode";
import {
  appointmentPushDisplayName,
  appointmentPushKind,
} from "@/lib/push-notifications/copy";

export type DashboardNotificationKind =
  | "action_item"
  | "appointment"
  | "system"
  | "package_ending"
  | "monthly_mid_period"
  | "health_share";

export type DashboardNotificationItem = {
  id: string;
  kind: DashboardNotificationKind;
  title: string;
  body: string;
  href: string;
  /** ISO — usado para ordenar (mais urgente primeiro). */
  sortAt: string;
  priority?: "high" | "medium" | "low";
};

export type DashboardNotificationsFeed = {
  items: DashboardNotificationItem[];
  /** Contagem para o badge do sino. */
  count: number;
};

const MAX_STORED_READ_IDS = 200;

function pendingActionItems(stored: unknown): ProfessionalActionItem[] {
  const parsed = professionalActionsStoredSchema.safeParse(stored);
  if (!parsed.success) return [];
  return parsed.data.items.filter((i) => i.completed !== true);
}

export function parseDashboardInboxReadIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Une IDs lidos, remove duplicados e limita tamanho (FIFO nos mais antigos). */
export function mergeDashboardInboxReadIds(
  existing: string[],
  toAdd: string[],
): string[] {
  const merged = [...existing];
  const seen = new Set(existing);
  for (const id of toAdd) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  if (merged.length <= MAX_STORED_READ_IDS) return merged;
  return merged.slice(merged.length - MAX_STORED_READ_IDS);
}

/**
 * Inbox unificado: pontos de ação pendentes + consultas do dia / próximas 24h.
 * Itens em `dashboardInboxReadIds` ficam ocultos até surgir um id novo.
 */
export async function buildDashboardNotificationsFeed(
  userId: string,
): Promise<DashboardNotificationsFeed> {
  const now = DateTime.now().setZone("America/Sao_Paulo");
  const dayEnd = now.endOf("day");
  const windowEnd = now.plus({ hours: 24 });

  const [evolutions, appointments, nearEndPurchases, monthlyPurchases, pushSubs, userRow] =
    await Promise.all([
    prisma.evolution.findMany({
      where: {
        professionalActions: { not: Prisma.DbNull },
        patient: { userId },
      },
      select: {
        id: true,
        date: true,
        professionalActions: true,
        patient: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 80,
    }),
    prisma.appointment.findMany({
      where: {
        professionalUserId: userId,
        status: AppointmentStatus.SCHEDULED,
        startAt: {
          gte: now.toJSDate(),
          lte: windowEnd.toJSDate(),
        },
      },
      select: {
        id: true,
        startAt: true,
        title: true,
        source: true,
        visitKind: true,
        timezoneAtBooking: true,
        patient: { select: { id: true, name: true, agendaOnly: true } },
      },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
    prisma.patientServicePurchase.findMany({
      where: {
        professionalUserId: userId,
        type: PatientServicePurchaseType.PACKAGE,
        billingMode: ServiceBillingMode.SESSION,
        sessionCountTotal: { gte: 2 },
        sessions: { some: { status: PatientServiceSessionStatus.PENDING } },
      },
      select: {
        id: true,
        updatedAt: true,
        sessionCountTotal: true,
        patient: { select: { id: true, name: true } },
        service: { select: { name: true } },
        sessions: {
          where: { status: PatientServiceSessionStatus.PENDING },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.patientServicePurchase.findMany({
      where: {
        professionalUserId: userId,
        billingMode: ServiceBillingMode.MONTHLY,
        periodStart: { not: null },
        periodEnd: { not: null },
      },
      select: {
        id: true,
        updatedAt: true,
        periodStart: true,
        periodEnd: true,
        patient: { select: { id: true, name: true } },
        service: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { dashboardInboxReadIds: true },
    }),
  ]);

  const sharedUpdates = await prisma.sharedHealthUpdate.findMany({
    where: {
      professionalUserId: userId,
      status: { in: ["INBOX", "ATTACHED"] },
      createdAt: { gte: now.minus({ days: 21 }).toJSDate() },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      chartPatientId: true,
      healthProfile: { select: { name: true } },
    },
  });

  const readIds = new Set(parseDashboardInboxReadIds(userRow?.dashboardInboxReadIds));
  const items: DashboardNotificationItem[] = [];

  const latestByPatient = new Map<string, (typeof evolutions)[number]>();
  for (const evo of evolutions) {
    if (!latestByPatient.has(evo.patient.id)) {
      latestByPatient.set(evo.patient.id, evo);
    }
  }

  for (const evo of latestByPatient.values()) {
    const pending = pendingActionItems(evo.professionalActions);
    if (pending.length === 0) continue;

    const high = pending.filter((i) => i.priority === "high").length;
    const sample = pending
      .slice(0, 2)
      .map((i) => i.label)
      .join(" · ");

    items.push({
      id: `action:${evo.patient.id}:${evo.id}`,
      kind: "action_item",
      title:
        pending.length === 1
          ? `Ponto de ação — ${evo.patient.name}`
          : `${pending.length} pontos de ação — ${evo.patient.name}`,
      body: high > 0 ? `${sample} (${high} alta prioridade)` : sample,
      href: `/dashboard/patients/${evo.patient.id}#evolucao-artifacts`,
      sortAt: evo.date.toISOString(),
      priority: high > 0 ? "high" : "medium",
    });
  }

  for (const appt of appointments) {
    const tz = appt.timezoneAtBooking || "America/Sao_Paulo";
    const start = DateTime.fromJSDate(appt.startAt, { zone: tz });
    const isToday = start <= dayEnd;
    const minutesUntil = Math.round(start.diff(now, "minutes").minutes);
    const timeLabel = start.toFormat("HH:mm");
    const dateLabel = isToday ? "hoje" : start.toFormat("dd/MM");
    const dateParam = start.toFormat("yyyy-LL-dd");
    const labelInput = {
      source: appt.source,
      title: appt.title,
      patientName: appt.patient.name,
      agendaOnly: appt.patient.agendaOnly,
      visitKind: appt.visitKind,
    };
    const displayName = appointmentPushDisplayName(labelInput);
    const pushKind = appointmentPushKind(labelInput);
    const noun =
      pushKind === "compromisso"
        ? "Compromisso"
        : pushKind === "sessao"
          ? "Sessão"
          : "Consulta";

    let title = isToday
      ? `${noun} hoje às ${timeLabel}`
      : `${noun} ${dateLabel} às ${timeLabel}`;
    if (minutesUntil <= 70 && minutesUntil >= 0) {
      title = `${noun} em ~${Math.max(1, minutesUntil)} min`;
    }

    items.push({
      id: `appointment:${appt.id}`,
      kind: "appointment",
      title,
      body: displayName,
      href: `/dashboard/agenda?date=${encodeURIComponent(dateParam)}&appointment=${encodeURIComponent(appt.id)}`,
      sortAt: appt.startAt.toISOString(),
      priority: minutesUntil <= 70 ? "high" : isToday ? "medium" : "low",
    });
  }

  for (const purchase of nearEndPurchases) {
    const pendingRemaining = purchase.sessions.length;
    if (
      !isPackageApproachingEnd({
        pendingRemaining,
        sessionCount: purchase.sessionCountTotal,
      })
    ) {
      continue;
    }
    const body =
      formatPackageNearEndWarning({
        pendingRemaining,
        sessionCount: purchase.sessionCountTotal,
        serviceName: purchase.service.name,
        patientName: purchase.patient.name,
      }) ?? `Restam ${pendingRemaining} sessão(ões) no plano.`;

    items.push({
      id: `package-ending:${purchase.id}:${pendingRemaining}`,
      kind: "package_ending",
      title:
        pendingRemaining === 1
          ? `Última sessão — ${purchase.patient.name}`
          : `Plano perto do fim — ${purchase.patient.name}`,
      body,
      href: `/dashboard/patients/${purchase.patient.id}?tab=services`,
      sortAt: purchase.updatedAt.toISOString(),
      priority: pendingRemaining === 1 ? "high" : "medium",
    });
  }

  for (const purchase of monthlyPurchases) {
    if (!purchase.periodStart || !purchase.periodEnd) continue;
    if (
      !isMonthlyPlanMidPeriod({
        periodStart: purchase.periodStart,
        periodEnd: purchase.periodEnd,
        now: now.toJSDate(),
      })
    ) {
      continue;
    }
    const periodKey = DateTime.fromJSDate(purchase.periodStart, { zone: "utc" })
      .setZone("America/Sao_Paulo")
      .toFormat("yyyy-LL");
    items.push({
      id: `monthly-mid:${purchase.id}:${periodKey}`,
      kind: "monthly_mid_period",
      title: `Meio da mensalidade — ${purchase.patient.name}`,
      body: formatMonthlyMidPeriodWarning({
        patientName: purchase.patient.name,
        serviceName: purchase.service.name,
        periodEnd: purchase.periodEnd,
      }),
      href: `/dashboard/patients/${purchase.patient.id}?tab=services`,
      sortAt: purchase.updatedAt.toISOString(),
      priority: "medium",
    });
  }

  if (pushSubs === 0) {
    items.push({
      id: "system:push-opt-in",
      kind: "system",
      title: "Ative as notificações push",
      body: "Receba lembretes de pontos de ação e da agenda mesmo com o app fechado.",
      href: "/dashboard/profile#notificacoes-push",
      sortAt: now.toUTC().toISO() ?? now.toJSDate().toISOString(),
      priority: "low",
    });
  }

  for (const update of sharedUpdates) {
    if (!update.chartPatientId) continue;
    const patientName = update.healthProfile.name?.trim() || "Paciente";
    items.push({
      id: `health-share:${update.id}`,
      kind: "health_share",
      title:
        update.status === "INBOX"
          ? `Informação nova — ${patientName}`
          : `Informação do mapa — ${patientName}`,
      body: update.title,
      href: `/dashboard/patients/${update.chartPatientId}?tab=mapa`,
      sortAt: update.createdAt.toISOString(),
      priority: update.status === "INBOX" ? "high" : "medium",
    });
  }

  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  items.sort((a, b) => {
    const pa = priorityRank[a.priority ?? "low"];
    const pb = priorityRank[b.priority ?? "low"];
    if (pa !== pb) return pa - pb;
    if (a.kind === "appointment" && b.kind === "appointment") {
      return a.sortAt.localeCompare(b.sortAt);
    }
    return b.sortAt.localeCompare(a.sortAt);
  });

  const visible = items.filter((i) => !readIds.has(i.id)).slice(0, 25);
  const count = visible.filter((i) => i.kind !== "system").length;

  return { items: visible, count };
}

/**
 * Marca os IDs atuais do feed (e opcionalmente extras) como lidos.
 * Retorna quantos IDs novos foram gravados.
 */
export async function markDashboardNotificationsRead(
  userId: string,
  ids: string[],
): Promise<{ saved: number }> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return { saved: 0 };

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { dashboardInboxReadIds: true },
  });
  const existing = parseDashboardInboxReadIds(row?.dashboardInboxReadIds);
  const merged = mergeDashboardInboxReadIds(existing, unique);
  const saved = merged.length - existing.length;

  await prisma.user.update({
    where: { id: userId },
    data: { dashboardInboxReadIds: merged },
  });

  return { saved: Math.max(0, saved) };
}
