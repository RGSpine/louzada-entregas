import type { CrmCommercialStage } from "@prisma/client";
import { getPlanLimits, type PlanType } from "@/lib/plan-limits";
import { isPaidPlan } from "@/lib/crm/plan-pricing-cents";
import type { CrmAccountSignals } from "@/lib/crm/types";
import { normalizePlanTier, type PlanTier } from "@/lib/plan-tier";
import type { CrmChurnRisk } from "@prisma/client";

function planTypeForLimits(plan: string | null | undefined): PlanType {
  const tier = normalizePlanTier(plan);
  if (!tier) return "BASICO";
  if (tier === "CONSULTORIO" || tier === "CLINICA") return "PREMIUM";
  if (tier === "PROFISSIONAL" || tier === "PREMIUM") return tier;
  return "BASICO";
}

function isNearLimit(current: number, max: number, ratio = 0.8): boolean {
  if (!Number.isFinite(max)) return false;
  return current >= max * ratio;
}

export function resolveCommercialStage(
  signals: CrmAccountSignals,
  churnRisk: CrmChurnRisk,
  hasRecentChurnEvent: boolean,
): CrmCommercialStage {
  if (signals.isInfluencer) return "INFLUENCER";

  const paid = isPaidPlan(signals.plan, false);
  const tier = normalizePlanTier(signals.plan);

  if (hasRecentChurnEvent || (!paid && tier === "BASICO" && hasRecentChurnEvent)) {
    return "CHURNED";
  }

  if (paid) {
    if (signals.stripeCancelAtPeriodEnd || signals.recentPaymentFailure) {
      return "AT_RISK";
    }
    if (churnRisk === "HIGH" || churnRisk === "CRITICAL") return "AT_RISK";
    return "CUSTOMER_PAID";
  }

  const limits = getPlanLimits(planTypeForLimits(signals.plan));
  const nearEvolutionLimit = isNearLimit(signals.evolutionCount, limits.maxEvolutions);
  const nearPatientLimit = isNearLimit(signals.patientCount, limits.maxPatients);
  const heavyFreeUsage = signals.totalEvolutions >= 5 || signals.evolutionsLast30Days >= 5;

  if (nearEvolutionLimit || nearPatientLimit || heavyFreeUsage) {
    return "OPPORTUNITY";
  }

  if (signals.firstEvolutionAt && signals.patientCount >= 1) {
    return "ENGAGED";
  }

  return "TRIAL_ACTIVE";
}

export function suggestUpgradeTarget(currentPlan: PlanTier | null | undefined): PlanTier | null {
  const tier = typeof currentPlan === "string" ? normalizePlanTier(currentPlan) : currentPlan ?? null;
  if (!tier) return "PROFISSIONAL";
  if (tier === "BASICO") return "PROFISSIONAL";
  if (tier === "PROFISSIONAL") return "PREMIUM";
  if (tier === "PREMIUM") return "CLINICA";
  if (tier === "CONSULTORIO") return "CLINICA";
  return null;
}
