"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { parseCouponPercentFromCode } from "@/lib/coupon-display";
import { resolveStripePromotionCode } from "@/lib/stripe-promotion-code";

export type ValidateCouponResult =
  | {
      success: true;
      code: string;
      percentOff: number;
      alreadyRedeemed: boolean;
    }
  | {
      success: false;
      error: string;
      alreadyRedeemed?: boolean;
    };

/**
 * Valida cupom na Stripe e devolve % para exibição (sufixo numérico do código).
 */
export async function validateCouponForDisplay(
  couponCode: string,
): Promise<ValidateCouponResult> {
  const normalized = couponCode.trim().toUpperCase();
  if (!normalized) {
    return { success: false, error: "Informe um cupom." };
  }

  const percentFromCode = parseCouponPercentFromCode(normalized);
  if (percentFromCode == null) {
    return {
      success: false,
      error: "Cupom sem percentual reconhecível no código (ex.: RGFISIO20).",
    };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { success: false, error: "Pagamentos não configurados." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser?.id) {
    return { success: false, error: "Faça login para validar o cupom." };
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { couponRedeemedAt: true },
  });

  const alreadyRedeemed = Boolean(dbUser?.couponRedeemedAt);

  const resolved = await resolveStripePromotionCode(normalized);
  if (!resolved) {
    return {
      success: false,
      error: "Cupom inválido ou inativo.",
      alreadyRedeemed,
    };
  }

  if (resolved.stripePercentOff != null && resolved.stripePercentOff !== percentFromCode) {
    return {
      success: false,
      error: `Cupom inválido: o desconto na Stripe (${resolved.stripePercentOff}%) não bate com o código (${percentFromCode}%).`,
      alreadyRedeemed,
    };
  }

  return {
    success: true,
    code: resolved.code,
    percentOff: percentFromCode,
    alreadyRedeemed,
  };
}
