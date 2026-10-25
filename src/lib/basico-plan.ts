/** Configuração comercial e migração do plano Básico (Fase 2). */

export const BASICO_TRIAL_DAYS = 14;
export const LEGACY_FREE_GRACE_DAYS = 7;

export const BASICO_PRICING = {
  monthly: "18,90",
  annualPerMonth: "15,12",
  annualTotal: "181,44",
} as const;

export const LEGACY_FREE_SUNSET_COPY =
  "O Louzada Entregas está crescendo! Para continuarmos oferecendo a melhor inteligência artificial e um tempo maior de gravação (agora 2 minutos!), nosso plano gratuito passou a exigir assinatura. Cadastre um cartão para assinar o Plano Básico por R$ 18,90/mês (ou R$ 15,12/mês no anual) e ganhe +14 dias de teste grátis.";

export type LegacyFreeMigrationUser = {
  plan: string | null;
  stripeSubscriptionId: string | null;
  isInfluencer: boolean;
  basicoCheckoutRequired: boolean;
  legacyFreeSunsetNoticeSentAt: Date | null;
  legacyFreeSunsetEndsAt: Date | null;
};

/**
 * @deprecated Free acabou. Mantido só para banner de migração de base legada
 * (BASICO/FREE sem Stripe). Novos cadastros NUNCA entram aqui (plan null + checkout).
 */
export function isLegacyFreeUser(user: LegacyFreeMigrationUser): boolean {
  if (user.isInfluencer) return false;
  if (user.basicoCheckoutRequired) return false;
  if (user.stripeSubscriptionId) return false;
  const plan = (user.plan ?? "").trim().toUpperCase();
  return plan === "BASICO" || plan === "FREE";
}

export function legacyFreeGraceDaysRemaining(endsAt: Date | null | undefined): number | null {
  if (!endsAt) return null;
  const ms = endsAt.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function isLegacyFreeGraceExpired(user: LegacyFreeMigrationUser): boolean {
  if (!isLegacyFreeUser(user)) return false;
  if (!user.legacyFreeSunsetEndsAt) return false;
  return user.legacyFreeSunsetEndsAt.getTime() <= Date.now();
}

export function shouldShowLegacyFreeSunsetBanner(user: LegacyFreeMigrationUser): boolean {
  if (!isLegacyFreeUser(user)) return false;
  if (!user.legacyFreeSunsetEndsAt) return true;
  return user.legacyFreeSunsetEndsAt.getTime() > Date.now();
}

/** Cadastro sem plano comercial (null, PENDING, INCOMPLETE, …). */
export function isPendingCheckoutPlan(plan: string | null | undefined): boolean {
  if (plan == null) return true;
  const upper = plan.trim().toUpperCase();
  return (
    upper === "" ||
    upper === "PENDING" ||
    upper === "INCOMPLETE" ||
    upper === "NONE"
  );
}

/**
 * Louzada não tem planos ativos. O cadastro entra direto, sem checkout Stripe.
 */
export function needsBasicoCheckout(_user: {
  basicoCheckoutRequired: boolean;
  stripeSubscriptionId: string | null;
  isInfluencer: boolean;
  plan?: string | null;
  accountStatus?: string | null;
}): boolean {
  return false;
}

/**
 * Acesso “ATIVO” ao produto: Stripe ou influenciador.
 * Conta INCOMPLETE / sem Stripe nunca é ativa.
 */
export function hasProductAccess(_user: {
  basicoCheckoutRequired: boolean;
  stripeSubscriptionId: string | null;
  isInfluencer: boolean;
  plan?: string | null;
  accountStatus?: string | null;
}): boolean {
  return true;
}

/** Conta criada mas sem assinatura Stripe concluída. */
export function isAwaitingPaidCheckout(user: {
  basicoCheckoutRequired: boolean;
  stripeSubscriptionId: string | null;
  isInfluencer: boolean;
  plan?: string | null;
  accountStatus?: string | null;
}): boolean {
  return !hasProductAccess(user);
}

/** Limites zerados enquanto o checkout obrigatório não for concluído. */
export const PENDING_CHECKOUT_LIMITS = {
  maxEvolutions: 0,
  maxPatients: 0,
  maxAudioMinutes: 0,
  canAnalyzeImages: false,
} as const;
