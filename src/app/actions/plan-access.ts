"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isPlatformOwnerEmail, resolveSessionEmail } from "@/lib/plan-limits";
import {
  isLegacyFreeGraceExpired,
  isLegacyFreeUser,
  LEGACY_FREE_GRACE_DAYS,
  legacyFreeGraceDaysRemaining,
  needsBasicoCheckout,
  shouldShowLegacyFreeSunsetBanner,
} from "@/lib/basico-plan";

export type PlanAccessGate = {
  needsBasicoCheckout: boolean;
  showLegacySunsetBanner: boolean;
  legacyGraceDaysRemaining: number | null;
  legacyGraceExpired: boolean;
};

export async function getPlanAccessGate(): Promise<PlanAccessGate | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.id) return null;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      plan: true,
      email: true,
      isInfluencer: true,
      stripeSubscriptionId: true,
      basicoCheckoutRequired: true,
      legacyFreeSunsetNoticeSentAt: true,
      legacyFreeSunsetEndsAt: true,
    },
  });

  if (!dbUser) return null;

  const sessionEmail = resolveSessionEmail(authUser.email, dbUser.email);
  if (isPlatformOwnerEmail(sessionEmail) || dbUser.isInfluencer) {
    return {
      needsBasicoCheckout: false,
      showLegacySunsetBanner: false,
      legacyGraceDaysRemaining: null,
      legacyGraceExpired: false,
    };
  }

  let migrationUser = {
    plan: dbUser.plan,
    stripeSubscriptionId: dbUser.stripeSubscriptionId,
    isInfluencer: dbUser.isInfluencer,
    basicoCheckoutRequired: dbUser.basicoCheckoutRequired,
    legacyFreeSunsetNoticeSentAt: dbUser.legacyFreeSunsetNoticeSentAt,
    legacyFreeSunsetEndsAt: dbUser.legacyFreeSunsetEndsAt,
  };

  // Inicia a janela de 7 dias no primeiro acesso ao dashboard (mesmo sem e-mail).
  if (isLegacyFreeUser(migrationUser) && !migrationUser.legacyFreeSunsetEndsAt) {
    const now = new Date();
    const endsAt = new Date(now.getTime() + LEGACY_FREE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        legacyFreeSunsetNoticeSentAt: migrationUser.legacyFreeSunsetNoticeSentAt ?? now,
        legacyFreeSunsetEndsAt: endsAt,
      },
    });
    migrationUser = {
      ...migrationUser,
      legacyFreeSunsetNoticeSentAt: migrationUser.legacyFreeSunsetNoticeSentAt ?? now,
      legacyFreeSunsetEndsAt: endsAt,
    };
  }

  return {
    needsBasicoCheckout: needsBasicoCheckout(migrationUser),
    showLegacySunsetBanner: shouldShowLegacyFreeSunsetBanner(migrationUser),
    // Só usuários free legado entram na janela de graça; demais planos → null.
    legacyGraceDaysRemaining: isLegacyFreeUser(migrationUser)
      ? (legacyFreeGraceDaysRemaining(migrationUser.legacyFreeSunsetEndsAt) ??
        LEGACY_FREE_GRACE_DAYS)
      : null,
    legacyGraceExpired: isLegacyFreeGraceExpired(migrationUser),
  };
}
