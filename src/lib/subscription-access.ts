/** Cookie httpOnly: trava Edge/middleware sem Prisma. */
export const PAID_ACCESS_COOKIE = "louzada_paid";

/** Valor: "1" = pode acessar produto; "0" = checkout pendente. */
export type PaidAccessCookieValue = "0" | "1";

export const PAID_ACCESS_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;

/**
 * Regra inviolável (produto): sem assinatura Stripe e sem isenção → checkout.
 * Isenções: influenciador; free legado ainda dentro da graça (passado via flag).
 */
export function lacksStripeSubscription(user: {
  stripeSubscriptionId: string | null | undefined;
  isInfluencer?: boolean;
}): boolean {
  if (user.isInfluencer) return false;
  return !user.stripeSubscriptionId?.trim();
}

/** Rotas do dashboard liberadas sem Stripe (funil de planos). */
export function isCheckoutAllowedDashboardPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/planos" ||
    pathname.startsWith("/dashboard/planos/") ||
    pathname === "/dashboard/upgrade" ||
    pathname.startsWith("/dashboard/upgrade")
  );
}
