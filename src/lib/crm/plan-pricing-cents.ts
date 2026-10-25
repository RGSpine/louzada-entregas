import { normalizePlanTier, type PlanTier } from "@/lib/plan-tier";

/** MRR estimado em centavos (BRL) por plano e intervalo. */
const MONTHLY_CENTS: Record<PlanTier, number> = {
  BASICO: 1890,
  PROFISSIONAL: 4990,
  PREMIUM: 8790,
  CONSULTORIO: 15980,
  CLINICA: 27370,
};

export function monthlyRevenueCentsForPlan(
  plan: string | null | undefined,
  planInterval: string | null | undefined,
): number {
  const tier = normalizePlanTier(plan);
  if (!tier) return 0;
  const monthly = MONTHLY_CENTS[tier];
  if (planInterval === "ANNUAL") {
    return Math.round(monthly * 0.8);
  }
  return monthly;
}

/** Tem assinatura paga ou benefício Premium (inclui influencer). */
export function isPaidPlan(
  plan: string | null | undefined,
  isInfluencer: boolean,
  stripeSubscriptionId?: string | null,
): boolean {
  if (isInfluencer) return true;
  if (stripeSubscriptionId) return true;
  const tier = normalizePlanTier(plan);
  if (!tier) return false;
  return tier !== "BASICO";
}

/** Gera receita direta (Stripe). Influencers têm Premium gratuito — não entram aqui. */
export function generatesDirectRevenue(
  plan: string | null | undefined,
  isInfluencer: boolean,
  stripeSubscriptionId?: string | null,
): boolean {
  if (isInfluencer) return false;
  if (stripeSubscriptionId) return true;
  const tier = normalizePlanTier(plan);
  if (!tier) return false;
  return tier !== "BASICO";
}

export function formatLtvLabel(ltvCents: number, isInfluencer: boolean): string {
  if (isInfluencer) return "Parceria";
  return formatCentsBrl(ltvCents);
}

export function formatCentsBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
