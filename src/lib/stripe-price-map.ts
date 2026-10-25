import type { CheckoutPlanType, PlanTier } from "@/lib/plan-tier";
import { normalizePlanTier } from "@/lib/plan-tier";

export const STRIPE_PRICE_ENV_KEYS = {
  BASICO_MONTHLY: "STRIPE_BASICO_MENSAL_PRICE_ID",
  BASICO_ANNUAL: "STRIPE_BASICO_ANUAL_PRICE_ID",
  PROFISSIONAL_MONTHLY: "STRIPE_PROFISSIONAL_MONTHLY_PRICE_ID",
  PROFISSIONAL_ANNUAL: "STRIPE_PROFISSIONAL_ANNUAL_PRICE_ID",
  PREMIUM_MONTHLY: "STRIPE_PREMIUM_MONTHLY_PRICE_ID",
  PREMIUM_ANNUAL: "STRIPE_PREMIUM_ANNUAL_PRICE_ID",
  CONSULTORIO_MONTHLY: "STRIPE_CONSULTORIO_MONTHLY_PRICE_ID",
  CONSULTORIO_ANNUAL: "STRIPE_CONSULTORIO_ANNUAL_PRICE_ID",
  CLINICA_MONTHLY: "STRIPE_CLINICA_MONTHLY_PRICE_ID",
  CLINICA_ANNUAL: "STRIPE_CLINICA_ANNUAL_PRICE_ID",
} as const;

/** Chaves legadas no .env (fallback durante migração de deploy). */
const LEGACY_STRIPE_ENV: Partial<Record<keyof typeof STRIPE_PRICE_ENV_KEYS, string>> = {
  PROFISSIONAL_MONTHLY: "STRIPE_STARTER_MONTHLY_PRICE_ID",
  PROFISSIONAL_ANNUAL: "STRIPE_STARTER_ANNUAL_PRICE_ID",
  PREMIUM_MONTHLY: "STRIPE_PRO_MONTHLY_PRICE_ID",
  PREMIUM_ANNUAL: "STRIPE_PRO_ANNUAL_PRICE_ID",
  CONSULTORIO_MONTHLY: "STRIPE_STARTER_CLINICA_MONTHLY_PRICE_ID",
  CONSULTORIO_ANNUAL: "STRIPE_STARTER_CLINICA_ANNUAL_PRICE_ID",
  CLINICA_MONTHLY: "STRIPE_PRO_CLINICA_MONTHLY_PRICE_ID",
  CLINICA_ANNUAL: "STRIPE_PRO_CLINICA_ANNUAL_PRICE_ID",
};

export type PlanInterval = "MONTHLY" | "ANNUAL";

const CHECKOUT_PRICE_KEY: Record<
  CheckoutPlanType,
  Record<PlanInterval, keyof typeof STRIPE_PRICE_ENV_KEYS>
> = {
  BASICO: {
    MONTHLY: "BASICO_MONTHLY",
    ANNUAL: "BASICO_ANNUAL",
  },
  PROFISSIONAL: {
    MONTHLY: "PROFISSIONAL_MONTHLY",
    ANNUAL: "PROFISSIONAL_ANNUAL",
  },
  PREMIUM: {
    MONTHLY: "PREMIUM_MONTHLY",
    ANNUAL: "PREMIUM_ANNUAL",
  },
  CONSULTORIO: {
    MONTHLY: "CONSULTORIO_MONTHLY",
    ANNUAL: "CONSULTORIO_ANNUAL",
  },
  CLINICA: {
    MONTHLY: "CLINICA_MONTHLY",
    ANNUAL: "CLINICA_ANNUAL",
  },
};

function readEnvPriceId(key: keyof typeof STRIPE_PRICE_ENV_KEYS): string | null {
  const primary = process.env[STRIPE_PRICE_ENV_KEYS[key]]?.trim();
  if (primary) return primary;
  const legacyKey = LEGACY_STRIPE_ENV[key];
  if (legacyKey) return process.env[legacyKey]?.trim() ?? null;
  return null;
}

export function resolveStripePriceId(
  planType: CheckoutPlanType,
  interval: PlanInterval,
): string | null {
  const envKey = CHECKOUT_PRICE_KEY[planType][interval];
  return readEnvPriceId(envKey);
}

function allConfiguredPriceIds(): { id: string; tier: PlanTier }[] {
  const pairs: { key: keyof typeof STRIPE_PRICE_ENV_KEYS; tier: PlanTier }[] = [
    { key: "BASICO_MONTHLY", tier: "BASICO" },
    { key: "BASICO_ANNUAL", tier: "BASICO" },
    { key: "PROFISSIONAL_MONTHLY", tier: "PROFISSIONAL" },
    { key: "PROFISSIONAL_ANNUAL", tier: "PROFISSIONAL" },
    { key: "PREMIUM_MONTHLY", tier: "PREMIUM" },
    { key: "PREMIUM_ANNUAL", tier: "PREMIUM" },
    { key: "CONSULTORIO_MONTHLY", tier: "CONSULTORIO" },
    { key: "CONSULTORIO_ANNUAL", tier: "CONSULTORIO" },
    { key: "CLINICA_MONTHLY", tier: "CLINICA" },
    { key: "CLINICA_ANNUAL", tier: "CLINICA" },
  ];
  return pairs
    .map(({ key, tier }) => {
      const id = readEnvPriceId(key);
      return id ? { id, tier } : null;
    })
    .filter((item): item is { id: string; tier: PlanTier } => item != null);
}

/** Infere plano a partir do price id Stripe (webhook / assinatura).
 * Desconhecido → null (NUNCA inventar BASICO — quebra Consultório/Clínica).
 */
export function planTierFromStripePriceId(
  priceId: string | null | undefined,
): PlanTier | null {
  if (!priceId) return null;
  const match = allConfiguredPriceIds().find((item) => item.id === priceId);
  return match?.tier ?? null;
}

export function planIntervalFromStripePriceId(
  priceId: string | null | undefined,
): PlanInterval | null {
  if (!priceId) return null;
  if (
    priceId === readEnvPriceId("BASICO_ANNUAL") ||
    priceId === readEnvPriceId("PROFISSIONAL_ANNUAL") ||
    priceId === readEnvPriceId("PREMIUM_ANNUAL") ||
    priceId === readEnvPriceId("CONSULTORIO_ANNUAL") ||
    priceId === readEnvPriceId("CLINICA_ANNUAL")
  ) {
    return "ANNUAL";
  }
  if (
    priceId === readEnvPriceId("BASICO_MONTHLY") ||
    priceId === readEnvPriceId("PROFISSIONAL_MONTHLY") ||
    priceId === readEnvPriceId("PREMIUM_MONTHLY") ||
    priceId === readEnvPriceId("CONSULTORIO_MONTHLY") ||
    priceId === readEnvPriceId("CLINICA_MONTHLY")
  ) {
    return "MONTHLY";
  }
  return null;
}

export function checkoutPlanTypeFromStoredPlan(
  plan: string | null | undefined,
): CheckoutPlanType | null {
  const tier = normalizePlanTier(plan);
  return tier;
}
