import Stripe from "stripe";

export type ResolvedStripePromotionCode = {
  promotionCodeId: string;
  code: string;
  /** Percentual do cupom Stripe, quando definido. */
  stripePercentOff: number | null;
};

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

/**
 * Resolve promotion code ativo na Stripe (mesma lógica do checkout).
 * Retorna null se inexistente, inativo ou Stripe não configurado.
 */
export async function resolveStripePromotionCode(
  couponCode: string,
): Promise<ResolvedStripePromotionCode | null> {
  const normalized = couponCode.trim().toUpperCase();
  if (!normalized) return null;

  const stripe = getStripeClient();
  if (!stripe) return null;

  const promotionCodeResult = await stripe.promotionCodes.list({
    code: normalized,
    active: true,
    limit: 1,
    expand: ["data.coupon"],
  });

  const promotionCode = promotionCodeResult.data[0];
  if (!promotionCode) return null;

  const coupon = (
    promotionCode as Stripe.PromotionCode & { coupon?: Stripe.Coupon | string | null }
  ).coupon;
  const stripePercentOff =
    coupon && typeof coupon !== "string" && coupon.percent_off != null
      ? coupon.percent_off
      : null;

  return {
    promotionCodeId: promotionCode.id,
    code: promotionCode.code,
    stripePercentOff,
  };
}
