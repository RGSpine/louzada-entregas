import { prisma } from "@/lib/prisma";
import { sendLegacyFreeSunsetEmail } from "@/lib/email";
import {
  BASICO_PRICING,
  BASICO_TRIAL_DAYS,
  isLegacyFreeUser,
  LEGACY_FREE_GRACE_DAYS,
} from "@/lib/basico-plan";

const BATCH_SIZE = 50;

export type LegacyFreeSunsetDispatchResult = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export async function dispatchLegacyFreeSunsetEmails(): Promise<LegacyFreeSunsetDispatchResult> {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const upgradeUrl = `${appUrl}/dashboard/planos`;

  const candidates = await prisma.user.findMany({
    where: {
      isBlocked: false,
      isInfluencer: false,
      basicoCheckoutRequired: false,
      stripeSubscriptionId: null,
      legacyFreeSunsetNoticeSentAt: null,
      OR: [{ plan: "BASICO" }, { plan: "FREE" }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      stripeSubscriptionId: true,
      isInfluencer: true,
      basicoCheckoutRequired: true,
      legacyFreeSunsetNoticeSentAt: true,
      legacyFreeSunsetEndsAt: true,
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  const result: LegacyFreeSunsetDispatchResult = {
    scanned: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const now = new Date();
  const endsAt = new Date(now.getTime() + LEGACY_FREE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  for (const user of candidates) {
    if (
      !isLegacyFreeUser({
        plan: user.plan,
        stripeSubscriptionId: user.stripeSubscriptionId,
        isInfluencer: user.isInfluencer,
        basicoCheckoutRequired: user.basicoCheckoutRequired,
        legacyFreeSunsetNoticeSentAt: user.legacyFreeSunsetNoticeSentAt,
        legacyFreeSunsetEndsAt: user.legacyFreeSunsetEndsAt,
      })
    ) {
      result.skipped += 1;
      continue;
    }

    if (!user.email) {
      result.skipped += 1;
      continue;
    }

    const send = await sendLegacyFreeSunsetEmail(user.email, upgradeUrl, {
      userName: user.name,
      monthlyPrice: BASICO_PRICING.monthly,
      annualPerMonth: BASICO_PRICING.annualPerMonth,
      trialDays: BASICO_TRIAL_DAYS,
      graceDays: LEGACY_FREE_GRACE_DAYS,
    });

    if (!send.success) {
      result.failed += 1;
      result.errors.push(`${user.email}: ${send.error ?? "erro desconhecido"}`);
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        legacyFreeSunsetNoticeSentAt: now,
        legacyFreeSunsetEndsAt: endsAt,
      },
    });

    result.sent += 1;
  }

  return result;
}
