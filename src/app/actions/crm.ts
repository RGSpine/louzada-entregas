"use server";

import { z } from "zod";
import {
  CrmAlertStatus,
  CrmCommercialStage,
  CrmConversationChannel,
  CrmPlanChangeReason,
  CrmSatisfactionType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { getCurrentAdmin } from "@/app/actions/admin";
import {
  CRM_ALERT_CHANNEL_LABELS,
  CRM_ALERT_SEVERITY_LABELS,
  CRM_ALERT_STATUS_LABELS,
  CRM_CHURN_LABELS,
  CRM_CONVERSATION_CHANNEL_LABELS,
  CRM_FEATURE_LABELS,
  CRM_PLAN_CHANGE_LABELS,
  CRM_SATISFACTION_LABELS,
  CRM_STAGE_LABELS,
  type CrmFeaturesActivated,
} from "@/lib/crm/types";
import {
  formatCentsBrl,
  formatLtvLabel,
  generatesDirectRevenue,
  monthlyRevenueCentsForPlan,
} from "@/lib/crm/plan-pricing-cents";
import { computeHealthBreakdown } from "@/lib/crm/health-score";
import { computeRetentionPriorityScore } from "@/lib/crm/priority";
import { playbooksForAlertTypes, type CrmPlaybook } from "@/lib/crm/playbooks";
import {
  ensureCrmProfile,
  isCrmSchemaMissingError,
  loadProductSignals,
  syncAllCrmAccounts,
  syncCrmAccount,
} from "@/lib/crm/sync-account";
import { planDisplayName } from "@/lib/plan-tier";
import { getUserActivityStatsMap } from "@/lib/admin-user-activity";

async function requireAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin.success || !admin.isAdmin) {
    throw new Error("Acesso negado.");
  }
  return admin;
}

export interface CrmOverviewStats {
  totalAccounts: number;
  avgHealthScore: number;
  atRiskCount: number;
  openAlerts: number;
  estimatedMrrCents: number;
  churnedLast30Days: number;
  /** Cancelamentos Stripe com acesso ainda ativo (cancel_at_period_end). */
  cancelScheduledCount: number;
  /** Assinaturas com currentPeriodEnd nos próximos 30 dias. */
  renewalsNext30Days: number;
  /** Falhas de pagamento Stripe em aberto. */
  paymentFailedCount: number;
  paidCustomers: number;
  influencerPartners: number;
  trialActive: number;
}

export interface CrmRenewalQueueItem {
  userId: string;
  name: string | null;
  email: string | null;
  planLabel: string;
  currentPeriodEnd: Date;
  mrrCents: number;
  healthScore: number;
  churnRisk: string;
  cancelScheduled: boolean;
}

export interface CrmAccountListItem {
  userId: string;
  profileId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  plan: string | null;
  planLabel: string;
  isInfluencer: boolean;
  commercialStage: CrmCommercialStage;
  commercialStageLabel: string;
  churnRisk: string;
  churnRiskLabel: string;
  healthScore: number;
  ltvCents: number;
  ltvLabel: string;
  lastActiveAt: Date | null;
  ahaMomentAt: Date | null;
  openAlerts: number;
  createdAt: Date;
  totalEvolutions: number;
  /** Cancelamento Stripe agendado — follow-up de retenção. */
  cancelScheduled: boolean;
  paymentFailed: boolean;
  currentPeriodEnd: Date | null;
  mrrCents: number;
  /** Risco × MRR — ordenação operacional. */
  priorityScore: number;
}

export interface CrmAccountDetail extends CrmAccountListItem {
  planInterval: string | null;
  features: CrmFeaturesActivated;
  featureLabels: { key: string; label: string; active: boolean }[];
  healthBreakdown: ReturnType<typeof computeHealthBreakdown>;
  firstEvolutionAt: Date | null;
  firstPatientAt: Date | null;
  firstAgendaAt: Date | null;
  firstFinanceAt: Date | null;
  firstChatAt: Date | null;
  firstDocumentAt: Date | null;
  ahaMomentType: string | null;
  referralCode: string | null;
  referredByUserId: string | null;
  referredByName: string | null;
  evolutionCount: number;
  patientCount: number;
  evolutionsLast30Days: number;
  evolutionsPrev30Days: number;
  daysSinceSignup: number;
  daysSinceActive: number | null;
  currentPeriodEnd: Date | null;
  playbooks: CrmPlaybook[];
  planChanges: {
    id: string;
    fromPlan: string;
    toPlan: string;
    reason: string;
    reasonLabel: string;
    reasonNote: string | null;
    source: string;
    createdAt: Date;
  }[];
  satisfactionSurveys: {
    id: string;
    type: string;
    typeLabel: string;
    score: number;
    feedback: string | null;
    milestoneAt: Date | null;
    createdAt: Date;
  }[];
  alerts: {
    id: string;
    alertType: string;
    severity: string;
    severityLabel: string;
    title: string;
    message: string;
    suggestedChannel: string;
    suggestedChannelLabel: string;
    suggestedMessage: string | null;
    status: string;
    statusLabel: string;
    triggeredAt: Date;
  }[];
  notes: {
    id: string;
    content: string;
    adminName: string | null;
    createdAt: Date;
  }[];
  conversations: {
    id: string;
    channel: string;
    channelLabel: string;
    direction: string;
    content: string;
    occurredAt: Date;
  }[];
}

function defaultFeatures(): CrmFeaturesActivated {
  return {
    evolution: false,
    patients: false,
    agenda: false,
    finance: false,
    chat: false,
    documents: false,
    googleCalendar: false,
  };
}

function mapFeatures(raw: Prisma.JsonValue | null): CrmFeaturesActivated {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultFeatures();
  }
  const f = raw as Record<string, boolean>;
  return {
    evolution: Boolean(f.evolution),
    patients: Boolean(f.patients),
    agenda: Boolean(f.agenda),
    finance: Boolean(f.finance),
    chat: Boolean(f.chat),
    documents: Boolean(f.documents),
    googleCalendar: Boolean(f.googleCalendar),
  };
}

export async function getCrmOverview(): Promise<{
  success: boolean;
  stats?: CrmOverviewStats;
  renewals?: CrmRenewalQueueItem[];
  error?: string;
}> {
  try {
    await requireAdmin();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let profiles = await prisma.crmAccountProfile.findMany({
        select: {
          healthScore: true,
          churnRisk: true,
          commercialStage: true,
        },
      });

    const userCount = await prisma.user.count();
    if (profiles.length === 0 && userCount > 0) {
      try {
        await syncAllCrmAccounts();
        profiles = await prisma.crmAccountProfile.findMany({
          select: {
            healthScore: true,
            churnRisk: true,
            commercialStage: true,
          },
        });
      } catch (syncErr) {
        if (isCrmSchemaMissingError(syncErr)) {
          return {
            success: false,
            error:
              "Tabelas CRM não encontradas. Execute: npx prisma migrate deploy",
          };
        }
        throw syncErr;
      }
    }

    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [
      openAlerts,
      churnedLast30Days,
      cancelScheduledCount,
      paymentFailedCount,
      renewalUsers,
      users,
    ] = await Promise.all([
      prisma.crmAlert.count({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      }),
      prisma.crmPlanChangeEvent.count({
        where: {
          reason: { in: ["CHURN_VOLUNTARY", "CHURN_PAYMENT_FAILED"] },
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.user.count({
        where: { stripeCancelAtPeriodEnd: true, isInfluencer: false },
      }),
      prisma.crmAlert.count({
        where: {
          alertType: "PAYMENT_FAILED",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
      }),
      prisma.user.findMany({
        where: {
          isInfluencer: false,
          currentPeriodEnd: { gte: now, lte: in30Days },
          plan: { notIn: ["NONE", "PENDING", "INCOMPLETE", "BASICO"] },
        },
        select: {
          id: true,
          name: true,
          email: true,
          plan: true,
          planInterval: true,
          currentPeriodEnd: true,
          stripeCancelAtPeriodEnd: true,
          crmProfile: {
            select: { healthScore: true, churnRisk: true },
          },
        },
        orderBy: { currentPeriodEnd: "asc" },
        take: 25,
      }),
      prisma.user.findMany({
        select: { plan: true, planInterval: true, isInfluencer: true },
      }),
    ]);

    const totalAccounts = profiles.length;
    const avgHealthScore =
      totalAccounts > 0
        ? Math.round(
            profiles.reduce((sum, p) => sum + p.healthScore, 0) / totalAccounts,
          )
        : 0;
    const atRiskCount = profiles.filter(
      (p) => p.churnRisk === "HIGH" || p.churnRisk === "CRITICAL",
    ).length;
    const trialActive = profiles.filter(
      (p) => p.commercialStage === "TRIAL_ACTIVE" || p.commercialStage === "ENGAGED",
    ).length;

    let estimatedMrrCents = 0;
    let paidCustomers = 0;
    let influencerPartners = 0;
    for (const u of users) {
      if (u.isInfluencer) {
        influencerPartners += 1;
        continue;
      }
      if (generatesDirectRevenue(u.plan, false)) {
        paidCustomers += 1;
        estimatedMrrCents += monthlyRevenueCentsForPlan(u.plan, u.planInterval);
      }
    }

    const renewals: CrmRenewalQueueItem[] = renewalUsers
      .filter((u) => u.currentPeriodEnd != null)
      .map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        planLabel: planDisplayName(u.plan as never),
        currentPeriodEnd: u.currentPeriodEnd!,
        mrrCents: monthlyRevenueCentsForPlan(u.plan, u.planInterval),
        healthScore: u.crmProfile?.healthScore ?? 0,
        churnRisk: u.crmProfile?.churnRisk ?? "LOW",
        cancelScheduled: u.stripeCancelAtPeriodEnd === true,
      }));

    return {
      success: true,
      stats: {
        totalAccounts,
        avgHealthScore,
        atRiskCount,
        openAlerts,
        estimatedMrrCents,
        churnedLast30Days,
        cancelScheduledCount,
        renewalsNext30Days: renewals.length,
        paymentFailedCount,
        paidCustomers,
        influencerPartners,
        trialActive,
      },
      renewals,
    };
  } catch (error) {
    console.error("[crm] getCrmOverview:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar CRM",
    };
  }
}

const listFiltersSchema = z.object({
  stage: z.nativeEnum(CrmCommercialStage).optional(),
  churnRisk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  search: z.string().max(120).optional(),
  /** Só contas com cancelamento Stripe agendado (cancel_at_period_end). */
  cancelScheduledOnly: z.boolean().optional(),
});

export async function getCrmAccounts(
  filters?: z.infer<typeof listFiltersSchema>,
): Promise<{ success: boolean; accounts?: CrmAccountListItem[]; error?: string }> {
  try {
    await requireAdmin();
    const parsed = listFiltersSchema.safeParse(filters ?? {});
    if (!parsed.success) {
      return { success: false, error: "Filtros inválidos." };
    }

    const profileCount = await prisma.crmAccountProfile.count();
    if (profileCount === 0) {
      const userCount = await prisma.user.count();
      if (userCount > 0) {
        try {
          await syncAllCrmAccounts();
        } catch (syncErr) {
          if (isCrmSchemaMissingError(syncErr)) {
            return {
              success: false,
              error:
                "Tabelas CRM não encontradas. Execute: npx prisma migrate deploy",
            };
          }
          throw syncErr;
        }
      }
    }

    const where: Prisma.CrmAccountProfileWhereInput = {};
    if (parsed.data.stage) where.commercialStage = parsed.data.stage;
    if (parsed.data.churnRisk) where.churnRisk = parsed.data.churnRisk;
    if (parsed.data.cancelScheduledOnly) {
      where.user = { stripeCancelAtPeriodEnd: true };
    }

    const profiles = await prisma.crmAccountProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profession: true,
            plan: true,
            isInfluencer: true,
            createdAt: true,
            stripeCancelAtPeriodEnd: true,
            currentPeriodEnd: true,
            planInterval: true,
          },
        },
        alerts: {
          where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          select: { id: true, alertType: true },
        },
      },
      orderBy: [{ churnRisk: "desc" }, { healthScore: "asc" }],
    });

    const search = parsed.data.search?.trim().toLowerCase();
    const activityMap = await getUserActivityStatsMap(
      profiles.map((p) => p.user.id),
    );

    const accounts: CrmAccountListItem[] = profiles
      .map((p) => {
        const activity = activityMap.get(p.user.id);
        const paymentFailed = p.alerts.some((a) => a.alertType === "PAYMENT_FAILED");
        const cancelScheduled = p.user.stripeCancelAtPeriodEnd === true;
        const mrrCents = p.user.isInfluencer
          ? 0
          : monthlyRevenueCentsForPlan(p.user.plan, p.user.planInterval);
        const priorityScore = computeRetentionPriorityScore({
          churnRisk: p.churnRisk,
          mrrCents,
          cancelScheduled,
          paymentFailed,
        });
        return {
        userId: p.user.id,
        profileId: p.id,
        name: p.user.name,
        email: p.user.email,
        phone: p.user.phone,
        profession: p.user.profession,
        plan: p.user.isInfluencer ? "PREMIUM" : p.user.plan,
        planLabel: p.user.isInfluencer
          ? "Premium (Influencer)"
          : planDisplayName(p.user.plan as never),
        isInfluencer: p.user.isInfluencer,
        commercialStage: p.commercialStage,
        commercialStageLabel: CRM_STAGE_LABELS[p.commercialStage],
        churnRisk: p.churnRisk,
        churnRiskLabel: CRM_CHURN_LABELS[p.churnRisk],
        healthScore: p.healthScore,
        ltvCents: p.user.isInfluencer ? 0 : p.ltvCents,
        ltvLabel: formatLtvLabel(p.ltvCents, p.user.isInfluencer),
        lastActiveAt: activity?.lastActiveAt ?? p.lastActiveAt,
        ahaMomentAt: p.ahaMomentAt,
        openAlerts: p.alerts.length,
        createdAt: p.user.createdAt,
        totalEvolutions: activity?.totalEvolutions ?? 0,
        cancelScheduled,
        paymentFailed,
        currentPeriodEnd: p.user.currentPeriodEnd,
        mrrCents,
        priorityScore,
      };
      })
      .filter((a) => {
        if (!search) return true;
        const hay = [a.name, a.email, a.phone, a.profession]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);

    return { success: true, accounts };
  } catch (error) {
    console.error("[crm] getCrmAccounts:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao listar contas",
    };
  }
}

export async function getCrmAccountDetail(
  userId: string,
): Promise<{ success: boolean; account?: CrmAccountDetail; error?: string }> {
  try {
    await requireAdmin();
    const sync = await syncCrmAccount(userId);
    if (!sync) return { success: false, error: "Usuário não encontrado." };

    const profile = await prisma.crmAccountProfile.findUnique({
      where: { userId },
      include: {
        user: true,
        referredBy: { select: { name: true, email: true } },
        planChanges: { orderBy: { createdAt: "desc" }, take: 20 },
        satisfactionSurveys: { orderBy: { createdAt: "desc" }, take: 20 },
        alerts: { orderBy: { triggeredAt: "desc" }, take: 30 },
        notes: {
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { admin: { select: { name: true, email: true } } },
        },
        conversations: { orderBy: { occurredAt: "desc" }, take: 50 },
      },
    });

    if (!profile) return { success: false, error: "Perfil CRM não encontrado." };

    const signals = sync.signals;
    const features = mapFeatures(profile.featuresActivated);
    const featureLabels = (Object.keys(CRM_FEATURE_LABELS) as (keyof CrmFeaturesActivated)[]).map(
      (key) => ({
        key,
        label: CRM_FEATURE_LABELS[key],
        active: features[key],
      }),
    );

    return {
      success: true,
      account: {
        userId: profile.userId,
        profileId: profile.id,
        name: profile.user.name,
        email: profile.user.email,
        phone: profile.user.phone,
        profession: profile.user.profession,
        plan: profile.user.isInfluencer ? "PREMIUM" : profile.user.plan,
        planLabel: profile.user.isInfluencer
          ? "Premium (Influencer)"
          : planDisplayName(profile.user.plan as never),
        planInterval: profile.user.planInterval,
        isInfluencer: profile.user.isInfluencer,
        commercialStage: profile.commercialStage,
        commercialStageLabel: CRM_STAGE_LABELS[profile.commercialStage],
        churnRisk: profile.churnRisk,
        churnRiskLabel: CRM_CHURN_LABELS[profile.churnRisk],
        healthScore: profile.healthScore,
        healthBreakdown: sync.health,
        ltvCents: profile.user.isInfluencer ? 0 : profile.ltvCents,
        ltvLabel: formatLtvLabel(profile.ltvCents, profile.user.isInfluencer),
        lastActiveAt: profile.lastActiveAt,
        ahaMomentAt: profile.ahaMomentAt,
        ahaMomentType: profile.ahaMomentType,
        openAlerts: profile.alerts.filter(
          (a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED",
        ).length,
        createdAt: profile.user.createdAt,
        totalEvolutions: signals.totalEvolutions,
        cancelScheduled: profile.user.stripeCancelAtPeriodEnd === true,
        paymentFailed: signals.recentPaymentFailure,
        mrrCents: profile.user.isInfluencer
          ? 0
          : monthlyRevenueCentsForPlan(
              profile.user.plan,
              profile.user.planInterval,
            ),
        priorityScore: computeRetentionPriorityScore({
          churnRisk: profile.churnRisk,
          mrrCents: profile.user.isInfluencer
            ? 0
            : monthlyRevenueCentsForPlan(
                profile.user.plan,
                profile.user.planInterval,
              ),
          cancelScheduled: profile.user.stripeCancelAtPeriodEnd === true,
          paymentFailed: signals.recentPaymentFailure,
        }),
        features,
        featureLabels,
        firstEvolutionAt: profile.firstEvolutionAt,
        firstPatientAt: profile.firstPatientAt,
        firstAgendaAt: profile.firstAgendaAt,
        firstFinanceAt: profile.firstFinanceAt,
        firstChatAt: profile.firstChatAt,
        firstDocumentAt: profile.firstDocumentAt,
        referralCode: profile.referralCode,
        referredByUserId: profile.referredByUserId,
        referredByName:
          profile.referredBy?.name ?? profile.referredBy?.email ?? null,
        evolutionCount: signals.evolutionCount,
        patientCount: signals.patientCount,
        evolutionsLast30Days: signals.evolutionsLast30Days,
        evolutionsPrev30Days: signals.evolutionsPrev30Days,
        daysSinceSignup: signals.daysSinceSignup,
        daysSinceActive: signals.daysSinceActive,
        currentPeriodEnd: signals.currentPeriodEnd,
        playbooks: playbooksForAlertTypes(
          profile.alerts
            .filter((a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED")
            .map((a) => a.alertType),
        ),
        planChanges: profile.planChanges.map((e) => ({
          id: e.id,
          fromPlan: e.fromPlan,
          toPlan: e.toPlan,
          reason: e.reason,
          reasonLabel: CRM_PLAN_CHANGE_LABELS[e.reason],
          reasonNote: e.reasonNote,
          source: e.source,
          createdAt: e.createdAt,
        })),
        satisfactionSurveys: profile.satisfactionSurveys.map((s) => ({
          id: s.id,
          type: s.type,
          typeLabel: CRM_SATISFACTION_LABELS[s.type],
          score: s.score,
          feedback: s.feedback,
          milestoneAt: s.milestoneAt,
          createdAt: s.createdAt,
        })),
        alerts: profile.alerts.map((a) => ({
          id: a.id,
          alertType: a.alertType,
          severity: a.severity,
          severityLabel: CRM_ALERT_SEVERITY_LABELS[a.severity],
          title: a.title,
          message: a.message,
          suggestedChannel: a.suggestedChannel,
          suggestedChannelLabel: CRM_ALERT_CHANNEL_LABELS[a.suggestedChannel],
          suggestedMessage: a.suggestedMessage,
          status: a.status,
          statusLabel: CRM_ALERT_STATUS_LABELS[a.status],
          triggeredAt: a.triggeredAt,
        })),
        notes: profile.notes.map((n) => ({
          id: n.id,
          content: n.content,
          adminName: n.admin.name ?? n.admin.email,
          createdAt: n.createdAt,
        })),
        conversations: profile.conversations.map((c) => ({
          id: c.id,
          channel: c.channel,
          channelLabel: CRM_CONVERSATION_CHANNEL_LABELS[c.channel],
          direction: c.direction,
          content: c.content,
          occurredAt: c.occurredAt,
        })),
      },
    };
  } catch (error) {
    console.error("[crm] getCrmAccountDetail:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar conta",
    };
  }
}

export async function refreshAllCrmData(): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    await requireAdmin();
    const { syncCancelScheduledFromStripe } = await import(
      "@/lib/crm/cancel-scheduled"
    );
    await syncCancelScheduledFromStripe();
    const synced = await syncAllCrmAccounts();
    return { success: true, synced };
  } catch (error) {
    if (isCrmSchemaMissingError(error)) {
      return {
        success: false,
        error: "Tabelas CRM não encontradas. Execute: npx prisma migrate deploy",
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao sincronizar",
    };
  }
}

const alertStatusSchema = z.object({
  alertId: z.string().min(1),
  status: z.nativeEnum(CrmAlertStatus),
});

export async function updateCrmAlertStatus(
  input: z.infer<typeof alertStatusSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = alertStatusSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    await prisma.crmAlert.update({
      where: { id: parsed.data.alertId },
      data: {
        status: parsed.data.status,
        resolvedAt:
          parsed.data.status === "RESOLVED" || parsed.data.status === "DISMISSED"
            ? new Date()
            : null,
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar alerta",
    };
  }
}

const noteSchema = z.object({
  profileId: z.string().min(1),
  content: z.string().min(3).max(5000),
});

export async function addCrmAdminNote(
  input: z.infer<typeof noteSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Nota inválida." };

    const adminUser = admin.user;
    if (!adminUser) return { success: false, error: "Admin não identificado." };

    await prisma.crmAdminNote.create({
      data: {
        profileId: parsed.data.profileId,
        adminUserId: adminUser.id,
        content: sanitizeText(parsed.data.content),
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao salvar nota",
    };
  }
}

const conversationSchema = z.object({
  profileId: z.string().min(1),
  channel: z.nativeEnum(CrmConversationChannel),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: z.string().min(3).max(8000),
  occurredAt: z.string().datetime().optional(),
});

export async function addCrmConversationLog(
  input: z.infer<typeof conversationSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    const parsed = conversationSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    await prisma.crmConversationLog.create({
      data: {
        profileId: parsed.data.profileId,
        channel: parsed.data.channel,
        direction: parsed.data.direction,
        content: sanitizeText(parsed.data.content),
        loggedByAdminId: admin.user?.id,
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : new Date(),
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao registrar conversa",
    };
  }
}

const satisfactionSchema = z.object({
  profileId: z.string().min(1),
  type: z.nativeEnum(CrmSatisfactionType),
  score: z.number().int().min(0).max(10),
  feedback: z.string().max(2000).optional(),
});

export async function addCrmSatisfactionSurvey(
  input: z.infer<typeof satisfactionSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = satisfactionSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    await prisma.crmSatisfactionSurvey.create({
      data: {
        profileId: parsed.data.profileId,
        type: parsed.data.type,
        score: parsed.data.score,
        feedback: parsed.data.feedback
          ? sanitizeText(parsed.data.feedback)
          : undefined,
        milestoneAt: new Date(),
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao registrar NPS",
    };
  }
}

const stageSchema = z.object({
  userId: z.string().min(1),
  commercialStage: z.nativeEnum(CrmCommercialStage),
});

export async function updateCrmCommercialStage(
  input: z.infer<typeof stageSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = stageSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    await ensureCrmProfile(parsed.data.userId);
    await prisma.crmAccountProfile.update({
      where: { userId: parsed.data.userId },
      data: { commercialStage: parsed.data.commercialStage },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar estágio",
    };
  }
}

const referrerSchema = z.object({
  userId: z.string().min(1),
  referredByUserId: z.string().nullable(),
  referralCode: z.string().max(32).nullable().optional(),
});

export async function updateCrmReferrer(
  input: z.infer<typeof referrerSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = referrerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    await ensureCrmProfile(parsed.data.userId);
    await prisma.crmAccountProfile.update({
      where: { userId: parsed.data.userId },
      data: {
        referredByUserId: parsed.data.referredByUserId,
        referralCode: parsed.data.referralCode ?? undefined,
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar indicação",
    };
  }
}

const planChangeNoteSchema = z.object({
  userId: z.string().min(1),
  reason: z.nativeEnum(CrmPlanChangeReason),
  reasonNote: z.string().min(3).max(2000),
});

export async function addCrmPlanChangeNote(
  input: z.infer<typeof planChangeNoteSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = planChangeNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Dados inválidos." };

    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { plan: true },
    });
    if (!user) return { success: false, error: "Usuário não encontrado." };

    const profile = await ensureCrmProfile(parsed.data.userId);
    await prisma.crmPlanChangeEvent.create({
      data: {
        profileId: profile.id,
        fromPlan: user.plan ?? "INCOMPLETE",
        toPlan: user.plan ?? "INCOMPLETE",
        reason: parsed.data.reason,
        reasonNote: sanitizeText(parsed.data.reasonNote),
        source: "ADMIN",
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao registrar motivo",
    };
  }
}

export async function getOpenCrmAlerts(): Promise<{
  success: boolean;
  alerts?: {
    id: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
    severity: string;
    severityLabel: string;
    title: string;
    suggestedChannelLabel: string;
    suggestedMessage: string | null;
    triggeredAt: Date;
  }[];
  error?: string;
}> {
  try {
    await requireAdmin();
    const rows = await prisma.crmAlert.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: [{ severity: "desc" }, { triggeredAt: "desc" }],
      take: 50,
      include: {
        profile: {
          include: {
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    return {
      success: true,
      alerts: rows.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.profile.user.name,
        userEmail: a.profile.user.email,
        severity: a.severity,
        severityLabel: CRM_ALERT_SEVERITY_LABELS[a.severity],
        title: a.title,
        suggestedChannelLabel: CRM_ALERT_CHANNEL_LABELS[a.suggestedChannel],
        suggestedMessage: a.suggestedMessage,
        triggeredAt: a.triggeredAt,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar alertas",
    };
  }
}
