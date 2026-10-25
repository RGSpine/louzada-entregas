import {
  CrmAhaMomentType,
  CrmPlanChangeReason,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildCrmAlertsForAccount,
  CRM_MANAGED_ALERT_TYPES,
} from "@/lib/crm/alerts";
import { resolveCommercialStage } from "@/lib/crm/commercial-stage";
import {
  computeChurnRisk,
  computeHealthBreakdown,
  estimateLtvCents,
} from "@/lib/crm/health-score";
import { notifyAdminCrmCritical } from "@/lib/crm/notify-critical";
import type {
  CrmAccountSignals,
  CrmAhaMomentCandidate,
  CrmFeaturesActivated,
} from "@/lib/crm/types";
import { comparePlanTiers, normalizePlanTier } from "@/lib/plan-tier";

const AHA_PRIORITY: CrmAhaMomentType[] = [
  "FIRST_EVOLUTION",
  "FIRST_PATIENT",
  "FIRST_AGENDA",
  "FIRST_FINANCE",
  "FIRST_CHAT",
  "FIRST_DOCUMENT",
];

function daysBetween(from: Date, to = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function pickAhaMoment(candidates: CrmAhaMomentCandidate[]): {
  ahaMomentAt: Date | null;
  ahaMomentType: CrmAhaMomentType | null;
} {
  const sorted = candidates
    .filter((c) => c.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sorted.length === 0) return { ahaMomentAt: null, ahaMomentType: null };
  const first = sorted[0];
  return { ahaMomentAt: first.at, ahaMomentType: first.type };
}

export async function ensureCrmProfile(userId: string) {
  return prisma.crmAccountProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

async function loadProductSignals(userId: string): Promise<CrmAccountSignals | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      profession: true,
      plan: true,
      planInterval: true,
      isInfluencer: true,
      createdAt: true,
      currentPeriodEnd: true,
      stripeCancelAtPeriodEnd: true,
      evolutionCount: true,
      patientCount: true,
      googleCalendarLastSyncedAt: true,
    },
  });
  if (!user) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const [
    firstEvolution,
    firstPatient,
    firstAgenda,
    firstFinance,
    firstChat,
    firstDocument,
    lastAccess,
    lastEvolution,
    evolutionsLast30Days,
    evolutionsPrev30Days,
    totalEvolutions,
    paidSince,
    paymentFailAlert,
  ] = await Promise.all([
    prisma.evolution.findFirst({
      where: { patient: { userId } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.patient.findFirst({
      where: { userId, agendaOnly: false },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.appointment.findFirst({
      where: { professionalUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.financialTransaction.findFirst({
      where: { professionalUserId: userId },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    }),
    prisma.patientChatSession.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.patientExam.findFirst({
      where: { patient: { userId } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.userAccessSession.findFirst({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    }),
    prisma.evolution.findFirst({
      where: { patient: { userId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.evolution.count({
      where: {
        patient: { userId },
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.evolution.count({
      where: {
        patient: { userId },
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
    }),
    prisma.evolution.count({
      where: { patient: { userId } },
    }),
    prisma.crmPlanChangeEvent.findFirst({
      where: {
        profile: { userId },
        toPlan: { not: "BASICO" },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.crmAlert.findFirst({
      where: {
        userId,
        alertType: "PAYMENT_FAILED",
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
      select: { id: true },
    }),
  ]);

  const firstEvolutionAt = firstEvolution?.createdAt ?? null;
  const firstPatientAt = firstPatient?.createdAt ?? null;
  const firstAgendaAt = firstAgenda?.createdAt ?? null;
  const firstFinanceAt = firstFinance?.occurredAt ?? null;
  const firstChatAt = firstChat?.createdAt ?? null;
  const firstDocumentAt = firstDocument?.createdAt ?? null;

  const lastActiveAt = [lastAccess?.lastSeenAt, lastEvolution?.createdAt, firstEvolutionAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? user.createdAt;

  const features: CrmFeaturesActivated = {
    evolution: totalEvolutions > 0,
    patients: user.patientCount > 0,
    agenda: Boolean(firstAgendaAt),
    finance: Boolean(firstFinanceAt),
    chat: Boolean(firstChatAt),
    documents: Boolean(firstDocumentAt),
    googleCalendar: Boolean(user.googleCalendarLastSyncedAt),
  };

  const daysSinceActive = lastActiveAt ? daysBetween(lastActiveAt) : null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    profession: user.profession,
    plan: user.plan,
    planInterval: user.planInterval,
    isInfluencer: user.isInfluencer,
    createdAt: user.createdAt,
    currentPeriodEnd: user.currentPeriodEnd,
    stripeCancelAtPeriodEnd: user.stripeCancelAtPeriodEnd === true,
    recentPaymentFailure: Boolean(paymentFailAlert),
    evolutionCount: user.evolutionCount,
    patientCount: user.patientCount,
    googleCalendarLastSyncedAt: user.googleCalendarLastSyncedAt,
    daysSinceSignup: daysBetween(user.createdAt),
    daysSinceActive,
    evolutionsLast30Days,
    evolutionsPrev30Days,
    totalEvolutions,
    features,
    firstEvolutionAt,
    firstPatientAt,
    firstAgendaAt,
    firstFinanceAt,
    firstChatAt,
    firstDocumentAt,
    lastActiveAt,
    paidSinceAt: paidSince?.createdAt ?? null,
  };
}

async function syncAlerts(
  profileId: string,
  userId: string,
  signals: CrmAccountSignals,
) {
  const definitions = buildCrmAlertsForAccount(signals);
  const desiredTypes = new Set(definitions.map((d) => d.alertType));

  const openManaged = await prisma.crmAlert.findMany({
    where: {
      profileId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      alertType: { in: [...CRM_MANAGED_ALERT_TYPES] },
    },
    select: { id: true, alertType: true },
  });

  const staleIds = openManaged
    .filter((a) => !desiredTypes.has(a.alertType))
    .map((a) => a.id);

  if (staleIds.length > 0) {
    await prisma.crmAlert.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  for (const def of definitions) {
    const existing = await prisma.crmAlert.findFirst({
      where: {
        profileId,
        alertType: def.alertType,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
    });
    if (existing) continue;

    const created = await prisma.crmAlert.create({
      data: {
        profileId,
        userId,
        alertType: def.alertType,
        severity: def.severity,
        title: def.title,
        message: def.message,
        suggestedChannel: def.suggestedChannel,
        suggestedMessage: def.suggestedMessage,
        metadata: def.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    if (def.severity === "CRITICAL") {
      void notifyAdminCrmCritical({
        alertId: created.id,
        userId,
        alertType: def.alertType,
        title: def.title,
        message: def.message,
        userName: signals.name,
        userEmail: signals.email,
        suggestedMessage: def.suggestedMessage,
      }).catch((err) =>
        console.error("[crm] notify critical after syncAlerts:", err),
      );
    }
  }
}

export async function syncCrmAccount(userId: string) {
  const signals = await loadProductSignals(userId);
  if (!signals) return null;

  const profile = await ensureCrmProfile(userId);

  const ahaCandidates: CrmAhaMomentCandidate[] = [];
  if (signals.firstEvolutionAt) {
    ahaCandidates.push({ type: "FIRST_EVOLUTION", at: signals.firstEvolutionAt });
  }
  if (signals.firstPatientAt) {
    ahaCandidates.push({ type: "FIRST_PATIENT", at: signals.firstPatientAt });
  }
  if (signals.firstAgendaAt) {
    ahaCandidates.push({ type: "FIRST_AGENDA", at: signals.firstAgendaAt });
  }
  if (signals.firstFinanceAt) {
    ahaCandidates.push({ type: "FIRST_FINANCE", at: signals.firstFinanceAt });
  }
  if (signals.firstChatAt) {
    ahaCandidates.push({ type: "FIRST_CHAT", at: signals.firstChatAt });
  }
  if (signals.firstDocumentAt) {
    ahaCandidates.push({ type: "FIRST_DOCUMENT", at: signals.firstDocumentAt });
  }

  const { ahaMomentAt, ahaMomentType } = pickAhaMoment(ahaCandidates);
  void AHA_PRIORITY;

  const health = computeHealthBreakdown(signals);
  const churnRisk = computeChurnRisk(signals, health.total);

  const recentChurn = await prisma.crmPlanChangeEvent.findFirst({
    where: {
      profileId: profile.id,
      reason: { in: ["CHURN_VOLUNTARY", "CHURN_PAYMENT_FAILED"] },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  const commercialStage = resolveCommercialStage(
    signals,
    churnRisk,
    Boolean(recentChurn),
  );

  const ltvCents = estimateLtvCents(signals, signals.paidSinceAt);

  if (signals.isInfluencer) {
    await prisma.crmAlert.updateMany({
      where: {
        profileId: profile.id,
        alertType: { in: ["INACTIVE_14D_PAID", "RENEWAL_7D", "CANCEL_SCHEDULED"] },
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
      data: { status: "DISMISSED", resolvedAt: new Date() },
    });
  }

  // Cancelamento agendado limpo na Stripe → resolve alerta residual.
  if (!signals.stripeCancelAtPeriodEnd) {
    await prisma.crmAlert.updateMany({
      where: {
        profileId: profile.id,
        alertType: "CANCEL_SCHEDULED",
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  const updated = await prisma.crmAccountProfile.update({
    where: { id: profile.id },
    data: {
      commercialStage,
      firstEvolutionAt: signals.firstEvolutionAt,
      firstPatientAt: signals.firstPatientAt,
      firstAgendaAt: signals.firstAgendaAt,
      firstFinanceAt: signals.firstFinanceAt,
      firstChatAt: signals.firstChatAt,
      firstDocumentAt: signals.firstDocumentAt,
      ahaMomentAt,
      ahaMomentType,
      featuresActivated: signals.features as Prisma.InputJsonValue,
      healthScore: health.total,
      churnRisk,
      ltvCents,
      lastActiveAt: signals.lastActiveAt,
      metricsComputedAt: new Date(),
    },
  });

  await syncAlerts(profile.id, userId, signals);

  return { profile: updated, signals, health };
}

export async function syncAllCrmAccounts() {
  const users = await prisma.user.findMany({ select: { id: true } });
  let synced = 0;
  const errors: string[] = [];
  for (const { id } of users) {
    try {
      await syncCrmAccount(id);
      synced += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[crm] sync failed for user", id, err);
      errors.push(msg);
    }
  }
  if (synced === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }
  return synced;
}

export function isCrmSchemaMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("crm_account_profile") ||
    msg.includes("does not exist") ||
    msg.includes("P2021")
  );
}

/** Motivos em que fromPlan === toPlan ainda devem gravar histórico. */
const SAME_PLAN_ALLOWED_REASONS: CrmPlanChangeReason[] = [
  "CANCEL_SCHEDULED",
  "COUPON",
  "ADMIN_ADJUSTMENT",
  "UNKNOWN",
];

export async function recordCrmPlanChange(input: {
  userId: string;
  fromPlan: string;
  toPlan: string;
  reason?: CrmPlanChangeReason;
  reasonNote?: string;
  source?: string;
  stripeEventId?: string;
}) {
  const from = normalizePlanTier(input.fromPlan);
  const to = normalizePlanTier(input.toPlan);
  const fromLabel = from ?? input.fromPlan ?? "INCOMPLETE";
  const toLabel = to ?? input.toPlan ?? "INCOMPLETE";
  const requestedReason = input.reason ?? "UNKNOWN";

  // Cancelamento agendado mantém o mesmo plano até o fim do período — ainda é evento.
  if (
    fromLabel === toLabel &&
    !SAME_PLAN_ALLOWED_REASONS.includes(requestedReason)
  ) {
    return null;
  }

  const profile = await ensureCrmProfile(input.userId);

  const existing = input.stripeEventId
    ? await prisma.crmPlanChangeEvent.findFirst({
        where: { stripeEventId: input.stripeEventId },
      })
    : null;
  if (existing) return existing;

  let reason = requestedReason;
  if (reason === "UNKNOWN" && from && to && fromLabel !== toLabel) {
    const cmp = comparePlanTiers(from, to);
    if (cmp < 0) reason = "UPGRADE_USAGE";
    else if (cmp > 0) reason = "DOWNGRADE_COST";
  }

  const event = await prisma.crmPlanChangeEvent.create({
    data: {
      profileId: profile.id,
      fromPlan: fromLabel,
      toPlan: toLabel,
      reason,
      reasonNote: input.reasonNote,
      source: input.source ?? "SYSTEM",
      stripeEventId: input.stripeEventId,
    },
  });

  await syncCrmAccount(input.userId);
  return event;
}

export { loadProductSignals };
