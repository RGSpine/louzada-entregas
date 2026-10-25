"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  canAnalyzeImages,
  canUseFinanceAssistant,
  canUseOfficeFinance,
  canUseServiceSpaces,
  canUsePatientClinicalChat,
  canUsePrioritySupport,
  canUseYieldManagement,
  canUseVisionInDocumentMerge,
  canUseAgendaIntake,
  canUseAgendaConfirmationColors,
  canUseAgendaFinanceProjection,
  canUseAgendaReports,
  getPlanLimits,
  BASICO_AI_DOCUMENTS_PER_MONTH,
  isBasicoPlanForDocumentQuota,
  isPlatformOwnerEmail,
  resolveSessionEmail,
  type PlanLimits,
} from "@/lib/plan-limits";
import {
  effectiveMonthlyEvolutionCount,
  type PlanUsageMetrics,
} from "@/lib/plan-usage-banner";

import { normalizePlanTier, type PlanTier } from "@/lib/plan-tier";
import { needsBasicoCheckout } from "@/lib/basico-plan";
import {
  cancelStripeBillingForUser,
  shouldClearLocalPlanAfterCancel,
} from "@/lib/stripe-billing-cancel";
import { revalidatePath } from "next/cache";

export type PlanType = PlanTier;

export interface GetCurrentPlanResult {
  success: boolean;
  /** Tier comercial ativo; null/undefined se ainda sem checkout. */
  plan?: PlanType | null;
  planInterval?: "MONTHLY" | "ANNUAL" | null;
  currentPeriodEnd?: Date | null;
  /** PRO via parceria; sem assinatura Stripe */
  isInfluencer?: boolean;
  /** Dono da plataforma (ADMIN_EMAIL): PRO sem Stripe, sem cobrança */
  isOwnerLifetimePro?: boolean;
  /**
   * Assinatura Stripe ativa (downgrade / portal).
   * Preferir `stripeSubscriptionId`; customer sozinho não implica portal útil.
   */
  hasStripeSubscription?: boolean;
  /**
   * Pode encerrar cobrança na Stripe (subscription e/ou customer).
   * Usar para mostrar "Cancelar assinatura" — cobre leftover só com customerId.
   */
  canCancelStripeBilling?: boolean;
  /**
   * Cadastro ainda sem plano pago — UI de planos não deve marcar nenhum card
   * como "plano atual" e deve oferecer checkout em todos.
   */
  needsCheckout?: boolean;
  /** Valor persistido em `User.plan` (null = incompleto). */
  storedPlan?: string | null;
  accountStatus?: string | null;
  error?: string;
}

export async function getCurrentPlan(): Promise<GetCurrentPlanResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.id) {
      return { success: false, error: "Não autenticado." };
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
      },
      select: {
        plan: true,
        planInterval: true,
        currentPeriodEnd: true,
        isInfluencer: true,
        email: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        basicoCheckoutRequired: true,
        accountStatus: true,
      },
    });

    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado." };
    }

    const sessionEmail = resolveSessionEmail(authUser.email, dbUser.email);
    if (isPlatformOwnerEmail(sessionEmail)) {
      return {
        success: true,
        plan: "PREMIUM",
        planInterval: null,
        currentPeriodEnd: null,
        isInfluencer: false,
        isOwnerLifetimePro: true,
        hasStripeSubscription: false,
        canCancelStripeBilling: false,
        needsCheckout: false,
      };
    }

    if (dbUser.isInfluencer) {
      return {
        success: true,
        plan: "PREMIUM",
        planInterval: null,
        currentPeriodEnd: null,
        isInfluencer: true,
        hasStripeSubscription: false,
        canCancelStripeBilling: false,
        needsCheckout: false,
      };
    }

    const checkoutPending = needsBasicoCheckout({
      basicoCheckoutRequired: dbUser.basicoCheckoutRequired,
      stripeSubscriptionId: dbUser.stripeSubscriptionId,
      isInfluencer: dbUser.isInfluencer,
      plan: dbUser.plan,
    });

    // Sem checkout: plan=null. NUNCA mascarar como BASICO (herança Free).
    const plan: PlanType | null = checkoutPending
      ? null
      : normalizePlanTier(dbUser.plan);
    const planInterval =
      dbUser.planInterval === "MONTHLY" || dbUser.planInterval === "ANNUAL"
        ? dbUser.planInterval
        : null;
    const hasStripeSubscription = Boolean(dbUser.stripeSubscriptionId);
    const canCancelStripeBilling = Boolean(
      dbUser.stripeSubscriptionId || dbUser.stripeCustomerId,
    );
    return {
      success: true,
      plan,
      planInterval,
      currentPeriodEnd: dbUser.currentPeriodEnd ?? null,
      isInfluencer: false,
      hasStripeSubscription,
      canCancelStripeBilling,
      needsCheckout: checkoutPending,
      storedPlan: dbUser.plan,
      accountStatus: dbUser.accountStatus ?? null,
    };
  } catch (error) {
    console.error("[getCurrentPlan]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar plano.",
    };
  }
}

export type CancelMySubscriptionResult = {
  success: boolean;
  error?: string;
  message?: string;
  endedTrialImmediately?: boolean;
  cancelAtPeriodEnd?: boolean;
};

/**
 * Cancela a assinatura Stripe a partir da UI do Louzada Entregas (sem apagar a conta).
 * Em trial: cancelamento imediato (sem cobrança).
 * Em plano pago ativo: agenda o fim no término do período já pago.
 */
export async function cancelMySubscription(): Promise<CancelMySubscriptionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.id) {
      return { success: false, error: "Não autenticado." };
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
      },
      select: {
        id: true,
        email: true,
        isInfluencer: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        currentPeriodEnd: true,
      },
    });

    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado." };
    }

    if (isPlatformOwnerEmail(resolveSessionEmail(authUser.email, dbUser.email))) {
      return { success: false, error: "Conta da plataforma não possui assinatura cancelável." };
    }

    if (dbUser.isInfluencer) {
      return { success: false, error: "Contas de parceria não usam assinatura Stripe." };
    }

    if (!dbUser.stripeCustomerId && !dbUser.stripeSubscriptionId) {
      return { success: false, error: "Nenhuma assinatura Stripe encontrada." };
    }

    const result = await cancelStripeBillingForUser({
      stripeCustomerId: dbUser.stripeCustomerId,
      stripeSubscriptionId: dbUser.stripeSubscriptionId,
      mode: "subscription_cancel",
      userId: dbUser.id,
    });

    if (!result.ok) {
      return {
        success: false,
        error: result.error ?? "Não foi possível cancelar na Stripe.",
      };
    }

    // Mistura leftovers cancelados + active agendado: NÃO limpar o plano local.
    // Só encerra acesso local quando nada ficou com cancel_at_period_end.
    const endedNow = shouldClearLocalPlanAfterCancel(
      result.primaryOutcome,
      result.canceledSubscriptionIds.length,
      result.scheduledCancelAtPeriodEndIds.length,
    );
    // Inclui leftovers agendados sem stripeSubscriptionId (primaryOutcome vinha "none").
    const scheduled =
      result.primaryOutcome === "scheduled" ||
      (!endedNow && result.scheduledCancelAtPeriodEndIds.length > 0);

    if (endedNow) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodEnd: null,
          plan: "NONE",
          accountStatus: "INCOMPLETE",
          planInterval: null,
          basicoCheckoutRequired: true,
          stripeCancelAtPeriodEnd: false,
        },
      });
      const { scheduleCrmPlanChange, scheduleCrmAccountSync } = await import(
        "@/lib/crm/touch"
      );
      scheduleCrmPlanChange({
        userId: dbUser.id,
        fromPlan: dbUser.plan ?? "NONE",
        toPlan: "NONE",
        reason: "CHURN_VOLUNTARY",
        source: "CANCEL_UI",
      });
      scheduleCrmAccountSync(dbUser.id);
    }

    revalidatePath("/dashboard/planos");
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard");

    if (endedNow) {
      return {
        success: true,
        endedTrialImmediately: result.endedTrialImmediately,
        message: result.endedTrialImmediately
          ? "Teste cancelado na Stripe. Nenhuma cobrança será feita."
          : "Assinatura cancelada na Stripe. O acesso foi encerrado.",
      };
    }

    if (scheduled) {
      const endLabel = dbUser.currentPeriodEnd
        ? new Intl.DateTimeFormat("pt-BR").format(dbUser.currentPeriodEnd)
        : "o fim do período já pago";

      const { markStripeCancelScheduled } = await import("@/lib/crm/cancel-scheduled");
      await markStripeCancelScheduled({
        userId: dbUser.id,
        fromPlan: dbUser.plan ?? "NONE",
        currentPeriodEnd: dbUser.currentPeriodEnd,
        source: "CANCEL_UI",
        reasonNote: `Cancelamento pedido na UI. Acesso até ${endLabel}.`,
      }).catch((err) =>
        console.error("[cancelMySubscription] CRM cancel scheduled:", err),
      );

      return {
        success: true,
        cancelAtPeriodEnd: true,
        message: `Cancelamento agendado na Stripe. Você mantém o acesso até ${endLabel}.`,
      };
    }

    // Defesa: se a Stripe não tinha nada aberto, tratamos como já encerrado
    // (evita falso erro quando o Dashboard já mostra "Cancelada").
    if (
      result.primaryOutcome === "canceled" ||
      result.primaryOutcome === "missing" ||
      result.primaryOutcome === "none"
    ) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodEnd: null,
          plan: "NONE",
          accountStatus: "INCOMPLETE",
          planInterval: null,
          basicoCheckoutRequired: true,
        },
      });
      revalidatePath("/dashboard/planos");
      revalidatePath("/dashboard/profile");
      revalidatePath("/dashboard");
      return {
        success: true,
        message: "Cobrança já estava encerrada na Stripe. O acesso local foi alinhado.",
      };
    }

    return {
      success: false,
      error:
        "Não foi possível encerrar a cobrança na Stripe (estado inesperado). Tente de novo ou fale com o suporte.",
    };
  } catch (error) {
    console.error("[cancelMySubscription]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao cancelar assinatura.",
    };
  }
}

export interface GetMyPlanLimitsResult {
  success: boolean;
  limits?: PlanLimits;
  plan?: PlanType | null;
  /** STARTER+/PRO/influenciador — pode anexar imagem/PDF no extrator financeiro. */
  officeFinanceAllowsImageUpload?: boolean;
  /** STARTER+ — agendar consultas na agenda por áudio ou foto. */
  canUseAgendaIntake?: boolean;
  /** STARTER+ — cores amarelo/verde de confirmação na agenda. */
  canUseAgendaConfirmationColors?: boolean;
  /** STARTER+ — projeção financeira na agenda semanal. */
  canUseAgendaFinanceProjection?: boolean;
  /** PRO — relatórios curtos da agenda por voz/texto. */
  canUseAgendaReports?: boolean;
  /** @deprecated Use canUseAgendaReports */
  canUseVoiceAgenda?: boolean;
  /** PRO — agente financeiro com IA. */
  canUseFinanceAssistant?: boolean;
  /** Premium+ — módulo Consultório financeiro (/dashboard/finances). */
  canUseOfficeFinance?: boolean;
  /** Consultório/Clínica — Espaços de Serviços (salas/unidades). */
  canUseServiceSpaces?: boolean;
  /** PRO — chat clínico por paciente com contexto das evoluções. */
  canUsePatientClinicalChat?: boolean;
  /** PRO — suporte prioritário via WhatsApp. */
  canUsePrioritySupport?: boolean;
  /** Premium+ — Gestão Inteligente / marketplace de ociosidade. */
  canUseYieldManagement?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  error?: string;
}

// ========== DADOS UNIFICADOS DO DASHBOARD ==========

export interface DashboardData {
  plan: PlanType | null;
  isOwnerLifetimePro: boolean;
  isInfluencer: boolean;
  isAdmin: boolean;
  totalPatients: number;
  totalEvolutions: number;
  /** Limite por gravação (minutos); `Infinity` para super-admin. */
  maxAudioMinutes: number;
  /** Uso vs limites numéricos (banner preventivo no dashboard). */
  usage: PlanUsageMetrics;
}

export interface GetDashboardDataResult {
  success: boolean;
  data?: DashboardData;
  error?: string;
}

/**
 * Busca todos os dados necessários para o dashboard em uma única chamada.
 * Faz UMA autenticação Supabase (evita race-condition de JWT refresh em paralelo).
 */
export async function getDashboardData(): Promise<GetDashboardDataResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser?.id) {
      return { success: false, error: "Não autenticado." };
    }

    const { hasAdminRole } = await import("@/lib/plan-limits");

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
      },
      select: {
        id: true,
        plan: true,
        email: true,
        role: true,
        isInfluencer: true,
        evolutionCount: true,
        evolutionCountResetAt: true,
        patientCount: true,
      },
    });

    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado." };
    }

    const sessionEmail = resolveSessionEmail(authUser.email, dbUser.email);

    const ownerLifetime = isPlatformOwnerEmail(sessionEmail);
    const plan: PlanType | null = ownerLifetime
      ? "PREMIUM"
      : dbUser.isInfluencer
        ? "PREMIUM"
        : normalizePlanTier(dbUser.plan);

    const isAdmin = hasAdminRole(dbUser.role, sessionEmail);

    const [totalPatients, totalEvolutions, documentsUsedThisMonth] = await Promise.all([
      prisma.patient.count({ where: { userId: dbUser.id } }),
      prisma.evolution.count({ where: { patient: { userId: dbUser.id } } }),
      isBasicoPlanForDocumentQuota(dbUser.plan, sessionEmail, dbUser.isInfluencer)
        ? prisma.patientExam.count({
            where: {
              source: "AI_GENERATED",
              patient: { userId: dbUser.id },
              createdAt: {
                gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
                lte: new Date(
                  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59, 999),
                ),
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const limits = getPlanLimits(dbUser.plan, sessionEmail, dbUser.isInfluencer);
    const evolutionsUsedThisMonth = effectiveMonthlyEvolutionCount(
      dbUser.evolutionCount,
      dbUser.evolutionCountResetAt,
    );

    return {
      success: true,
      data: {
        plan,
        isOwnerLifetimePro: ownerLifetime,
        isInfluencer: dbUser.isInfluencer,
        isAdmin,
        totalPatients,
        totalEvolutions,
        maxAudioMinutes: limits.maxAudioMinutes,
        usage: {
          evolutionsUsedThisMonth,
          evolutionsLimit: limits.maxEvolutions,
          patientsUsed: dbUser.patientCount,
          patientsLimit: limits.maxPatients,
          documentsUsedThisMonth,
          documentsLimit:
            documentsUsedThisMonth != null ? BASICO_AI_DOCUMENTS_PER_MONTH : null,
        },
      },
    };
  } catch (error) {
    console.error("[getDashboardData]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar dados do Menu Principal.",
    };
  }
}

// ========== LIMITES DO PLANO ==========

export async function getMyPlanLimits(): Promise<GetMyPlanLimitsResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser?.id) {
      return { success: false, error: "Não autenticado." };
    }
    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }] },
      select: { plan: true, email: true, isInfluencer: true, name: true },
    });
    if (!dbUser) {
      return { success: false, error: "Usuário não encontrado." };
    }
    const sessionEmail = resolveSessionEmail(authUser.email, dbUser.email);
    const plan: PlanType | null = isPlatformOwnerEmail(sessionEmail)
      ? "PREMIUM"
      : dbUser.isInfluencer
        ? "PREMIUM"
        : normalizePlanTier(dbUser.plan);
    const limits = getPlanLimits(dbUser.plan, dbUser.email, dbUser.isInfluencer);
    return {
      success: true,
      limits,
      plan,
      officeFinanceAllowsImageUpload:
        canAnalyzeImages(dbUser.plan, dbUser.email, dbUser.isInfluencer) ||
        canUseVisionInDocumentMerge(dbUser.plan, dbUser.email, dbUser.isInfluencer),
      canUseAgendaIntake: canUseAgendaIntake(dbUser.plan, dbUser.email, dbUser.isInfluencer),
      canUseAgendaConfirmationColors: canUseAgendaConfirmationColors(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUseAgendaFinanceProjection: canUseAgendaFinanceProjection(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUseAgendaReports: canUseAgendaReports(dbUser.plan, dbUser.email, dbUser.isInfluencer),
      canUseVoiceAgenda: canUseAgendaReports(dbUser.plan, dbUser.email, dbUser.isInfluencer),
      canUseFinanceAssistant: canUseFinanceAssistant(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUseOfficeFinance: canUseOfficeFinance(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUseServiceSpaces: canUseServiceSpaces(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUsePatientClinicalChat: canUsePatientClinicalChat(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUsePrioritySupport: canUsePrioritySupport(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      canUseYieldManagement: canUseYieldManagement(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer,
      ),
      userName: dbUser.name,
      userEmail: sessionEmail ?? dbUser.email,
    };
  } catch (error) {
    console.error("[getMyPlanLimits]", error);
    return { success: false, error: "Erro ao carregar limites." };
  }
}
