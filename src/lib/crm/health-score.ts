import type { CrmChurnRisk } from "@prisma/client";
import { getPlanLimits } from "@/lib/plan-limits";
import {
  generatesDirectRevenue,
  isPaidPlan,
  monthlyRevenueCentsForPlan,
} from "@/lib/crm/plan-pricing-cents";
import type { CrmAccountSignals, CrmFeaturesActivated, CrmHealthBreakdown } from "@/lib/crm/types";

function countActivatedFeatures(features: CrmFeaturesActivated): number {
  return Object.values(features).filter(Boolean).length;
}

/**
 * Health 0–100 (Sprint B):
 * recência 30 + frequência 15 + tendência MoM 20 + amplitude 15 + plan fit 10 + pagamento 10.
 */
export function computeHealthBreakdown(signals: CrmAccountSignals): CrmHealthBreakdown {
  let recency = 0;
  const days = signals.daysSinceActive;
  if (days === null) {
    recency = 0;
  } else if (days <= 3) {
    recency = 30;
  } else if (days <= 7) {
    recency = 22;
  } else if (days <= 14) {
    recency = 14;
  } else if (days <= 30) {
    recency = 7;
  }

  let frequency = 0;
  const evo30 = signals.evolutionsLast30Days;
  if (evo30 >= 10) frequency = 15;
  else if (evo30 >= 5) frequency = 12;
  else if (evo30 >= 2) frequency = 8;
  else if (evo30 >= 1) frequency = 4;

  // Tendência MoM: queda >30% vs mês anterior = zona de perigo (ChurnGuard).
  let usageTrend = 10;
  const prev = signals.evolutionsPrev30Days;
  if (prev <= 0 && evo30 > 0) {
    usageTrend = 18;
  } else if (prev <= 0 && evo30 <= 0) {
    usageTrend = signals.daysSinceSignup < 30 ? 12 : 4;
  } else {
    const ratio = evo30 / prev;
    if (ratio >= 1.1) usageTrend = 20;
    else if (ratio >= 0.9) usageTrend = 16;
    else if (ratio >= 0.7) usageTrend = 10;
    else if (ratio >= 0.5) usageTrend = 5;
    else usageTrend = 0;
  }

  const activated = countActivatedFeatures(signals.features);
  const breadth = Math.round((activated / 7) * 15);

  let planFit = 0;
  const paid = generatesDirectRevenue(signals.plan, signals.isInfluencer);
  const hasProAccess = isPaidPlan(signals.plan, signals.isInfluencer);
  const limits = getPlanLimits(signals.plan);

  if (paid && signals.evolutionsLast30Days >= 2) {
    planFit = 10;
  } else if (!hasProAccess && signals.evolutionsLast30Days >= 3) {
    planFit = 7;
  } else if (paid && signals.evolutionsLast30Days === 0) {
    planFit = 0;
  } else if (!hasProAccess && signals.patientCount >= 1) {
    planFit = 5;
  }

  void limits;

  let paymentHealth = 10;
  if (signals.recentPaymentFailure) paymentHealth = 0;
  else if (signals.stripeCancelAtPeriodEnd) paymentHealth = 3;

  const total = Math.min(
    100,
    recency + frequency + usageTrend + breadth + planFit + paymentHealth,
  );
  return { recency, frequency, usageTrend, breadth, planFit, paymentHealth, total };
}

export function computeChurnRisk(signals: CrmAccountSignals, healthScore: number): CrmChurnRisk {
  const paid = generatesDirectRevenue(signals.plan, signals.isInfluencer);
  const days = signals.daysSinceActive ?? 999;
  const daysSinceSignup = signals.daysSinceSignup;

  const renewalSoon =
    signals.currentPeriodEnd != null &&
    signals.currentPeriodEnd.getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000 &&
    signals.currentPeriodEnd.getTime() > Date.now();

  if (signals.recentPaymentFailure && paid) return "CRITICAL";
  if (signals.stripeCancelAtPeriodEnd && paid) return "CRITICAL";
  if (paid && days >= 14) return "CRITICAL";
  if (paid && days >= 7) return "HIGH";
  if (renewalSoon && healthScore < 50) return "HIGH";
  if (paid && healthScore < 35) return "HIGH";

  const prev = signals.evolutionsPrev30Days;
  const curr = signals.evolutionsLast30Days;
  if (paid && prev >= 3 && curr / prev < 0.7) return "HIGH";

  if (!paid && daysSinceSignup > 21 && days >= 14) return "MEDIUM";
  if (!paid && daysSinceSignup > 7 && signals.totalEvolutions === 0) return "MEDIUM";
  if (healthScore < 25) return "MEDIUM";
  return "LOW";
}

export function estimateLtvCents(signals: CrmAccountSignals, paidSinceAt: Date | null): number {
  if (!generatesDirectRevenue(signals.plan, signals.isInfluencer)) {
    return 0;
  }
  const mrr = monthlyRevenueCentsForPlan(signals.plan, signals.planInterval);
  if (mrr === 0) return 0;

  const start = paidSinceAt ?? signals.createdAt;
  const monthsActive = Math.max(
    1,
    Math.ceil((Date.now() - start.getTime()) / (30 * 24 * 60 * 60 * 1000)),
  );
  return mrr * monthsActive;
}
