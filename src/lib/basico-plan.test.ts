import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLegacyFreeGraceExpired,
  needsBasicoCheckout,
  shouldShowLegacyFreeSunsetBanner,
  type LegacyFreeMigrationUser,
} from "./basico-plan";

function legacyUser(
  overrides: Partial<LegacyFreeMigrationUser> = {},
): LegacyFreeMigrationUser {
  return {
    plan: "BASICO",
    stripeSubscriptionId: null,
    isInfluencer: false,
    basicoCheckoutRequired: false,
    legacyFreeSunsetNoticeSentAt: null,
    legacyFreeSunsetEndsAt: null,
    ...overrides,
  };
}

describe("legacy free sunset banner", () => {
  it("mostra banner para free legado sem e-mail enviado", () => {
    assert.equal(shouldShowLegacyFreeSunsetBanner(legacyUser()), true);
  });

  it("mostra banner durante a janela de graça", () => {
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    assert.equal(
      shouldShowLegacyFreeSunsetBanner(
        legacyUser({
          legacyFreeSunsetNoticeSentAt: new Date(),
          legacyFreeSunsetEndsAt: endsAt,
        }),
      ),
      true,
    );
  });

  it("não mostra banner após expirar a graça", () => {
    const endsAt = new Date(Date.now() - 60_000);
    assert.equal(
      shouldShowLegacyFreeSunsetBanner(
        legacyUser({
          legacyFreeSunsetNoticeSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          legacyFreeSunsetEndsAt: endsAt,
        }),
      ),
      false,
    );
    assert.equal(
      isLegacyFreeGraceExpired(
        legacyUser({
          legacyFreeSunsetNoticeSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          legacyFreeSunsetEndsAt: endsAt,
        }),
      ),
      true,
    );
  });

  it("não mostra para assinante Stripe ou influencer", () => {
    assert.equal(
      shouldShowLegacyFreeSunsetBanner(legacyUser({ stripeSubscriptionId: "sub_x" })),
      false,
    );
    assert.equal(shouldShowLegacyFreeSunsetBanner(legacyUser({ isInfluencer: true })), false);
  });
});

describe("needsBasicoCheckout", () => {
  it("bloqueia PENDING mesmo sem flag", () => {
    assert.equal(
      needsBasicoCheckout({
        basicoCheckoutRequired: false,
        stripeSubscriptionId: null,
        isInfluencer: false,
        plan: "PENDING",
      }),
      true,
    );
  });

  it("bloqueia flag de checkout sem assinatura", () => {
    assert.equal(
      needsBasicoCheckout({
        basicoCheckoutRequired: true,
        stripeSubscriptionId: null,
        isInfluencer: false,
        plan: "BASICO",
      }),
      true,
    );
  });

  it("libera assinante Stripe", () => {
    assert.equal(
      needsBasicoCheckout({
        basicoCheckoutRequired: true,
        stripeSubscriptionId: "sub_1",
        isInfluencer: false,
        plan: "BASICO",
      }),
      false,
    );
  });

  it("Free acabou: BASICO sem Stripe também exige checkout", () => {
    assert.equal(
      needsBasicoCheckout({
        basicoCheckoutRequired: false,
        stripeSubscriptionId: null,
        isInfluencer: false,
        plan: "BASICO",
      }),
      true,
    );
  });
});
