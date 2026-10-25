/** Tiers comerciais persistidos em `User.plan` após checkout Stripe. */
export type PlanTier =
  | "BASICO"
  | "PROFISSIONAL"
  | "PREMIUM"
  | "CONSULTORIO"
  | "CLINICA";

export type PlanSegment = "INDIVIDUAL" | "CLINICA";

/** Planos pagos disponíveis no checkout Stripe. */
export type CheckoutPlanType =
  | "BASICO"
  | "PROFISSIONAL"
  | "PREMIUM"
  | "CONSULTORIO"
  | "CLINICA";

/** Status de conta (User.accountStatus). ACTIVE só via Stripe webhook / isenção. */
export type AccountStatus = "INCOMPLETE" | "ACTIVE" | "BLOCKED";

const TIER_RANK: Record<PlanTier, number> = {
  BASICO: 0,
  PROFISSIONAL: 1,
  PREMIUM: 2,
  CONSULTORIO: 3,
  CLINICA: 4,
};

/** Mapeia valores legados (pré-refatoração de nomenclatura). */
const LEGACY_TIER_MAP: Record<string, PlanTier> = {
  FREE: "BASICO",
  STARTER: "PROFISSIONAL",
  PRO: "PREMIUM",
  STARTER_CLINICA: "CONSULTORIO",
  PRO_CLINICA: "CLINICA",
};

/**
 * Sem plano comercial: null, vazio, PENDING, INCOMPLETE, NONE.
 * NUNCA deve ser tratado como Básico ativo.
 */
export function isIncompletePlan(value: string | null | undefined): boolean {
  if (value == null) return true;
  const upper = value.trim().toUpperCase();
  return (
    upper === "" ||
    upper === "PENDING" ||
    upper === "INCOMPLETE" ||
    upper === "NONE" ||
    upper === "NULL"
  );
}

export function planSegment(tier: PlanTier): PlanSegment {
  if (tier === "CONSULTORIO" || tier === "CLINICA") return "CLINICA";
  return "INDIVIDUAL";
}

export function isClinicaPlanTier(tier: PlanTier): boolean {
  return planSegment(tier) === "CLINICA";
}

/** Consultório e Clínica aparecem na vitrine como o estabelecimento, não como cada pessoa da equipe. */
export function organizationPlanLabel(
  value: string | null | undefined,
): "Consultório" | "Clínica" | null {
  const tier = normalizePlanTier(value);
  if (tier === "CONSULTORIO") return "Consultório";
  if (tier === "CLINICA") return "Clínica";
  return null;
}

/**
 * Converte valor persistido em tier comercial.
 * Incomplete/null/PENDING → **null** (NÃO inventa BASICO — herança Free morta).
 */
export function normalizePlanTier(value: string | null | undefined): PlanTier | null {
  if (isIncompletePlan(value)) return null;
  const upper = value!.trim().toUpperCase();
  if (upper in LEGACY_TIER_MAP) return LEGACY_TIER_MAP[upper]!;
  if (
    upper === "BASICO" ||
    upper === "PROFISSIONAL" ||
    upper === "PREMIUM" ||
    upper === "CONSULTORIO" ||
    upper === "CLINICA"
  ) {
    return upper as PlanTier;
  }
  return null;
}

/**
 * Só para metadata Stripe já validada no checkout.
 * Nunca use em signup / leitura de perfil sem assinatura.
 */
export function requireCheckoutPlanTier(
  value: string | null | undefined,
): PlanTier | null {
  const tier = normalizePlanTier(value);
  if (!tier) return null;
  return tier;
}

export function planDisplayName(tier: PlanTier | string | null | undefined): string {
  if (isIncompletePlan(tier)) return "Sem plano";
  const raw = (tier ?? "").trim().toUpperCase();
  if (raw === "PENDING" || raw === "INCOMPLETE") return "Sem plano";
  const normalized = normalizePlanTier(tier);
  if (!normalized) return "Sem plano";
  switch (normalized) {
    case "CONSULTORIO":
      return "Consultório";
    case "CLINICA":
      return "Clínica";
    case "PROFISSIONAL":
      return "Profissional";
    case "PREMIUM":
      return "Premium";
    case "BASICO":
      return "Básico";
    default:
      return "Sem plano";
  }
}

export function comparePlanTiers(a: PlanTier, b: PlanTier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

export function isUpgradeTarget(current: PlanTier, card: PlanTier): boolean {
  return comparePlanTiers(card, current) > 0;
}

export function isDowngradeTarget(current: PlanTier, card: PlanTier): boolean {
  return comparePlanTiers(card, current) < 0;
}

export function isCurrentPlanTier(current: PlanTier | null, card: PlanTier): boolean {
  if (!current) return false;
  return current === card;
}
