import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAwaitingPaidCheckout,
  needsBasicoCheckout,
  isPendingCheckoutPlan,
  hasProductAccess,
} from "./basico-plan";
import { planDisplayName, normalizePlanTier, isIncompletePlan } from "./plan-tier";
import { isCheckoutAllowedDashboardPath, lacksStripeSubscription } from "./subscription-access";

describe("onboarding — desacoplar auth de assinatura", () => {
  it("null/INCOMPLETE/PENDING forçam checkout (Free acabou)", () => {
    assert.equal(isPendingCheckoutPlan(null), true);
    assert.equal(isPendingCheckoutPlan("INCOMPLETE"), true);
    assert.equal(isPendingCheckoutPlan("PENDING"), true);
    assert.equal(isIncompletePlan(null), true);
    assert.equal(normalizePlanTier(null), null);
    assert.equal(normalizePlanTier("PENDING"), null);
    assert.equal(normalizePlanTier("INCOMPLETE"), null);
    assert.equal(
      needsBasicoCheckout({
        plan: null,
        basicoCheckoutRequired: false,
        stripeSubscriptionId: null,
        isInfluencer: false,
      }),
      true,
    );
    // Mesmo BASICO legado sem Stripe exige checkout (Free morto)
    assert.equal(
      needsBasicoCheckout({
        plan: "BASICO",
        basicoCheckoutRequired: false,
        stripeSubscriptionId: null,
        isInfluencer: false,
      }),
      true,
    );
  });

  it("assinatura Stripe libera o produto", () => {
    assert.equal(
      needsBasicoCheckout({
        plan: "BASICO",
        basicoCheckoutRequired: false,
        stripeSubscriptionId: "sub_paid",
        isInfluencer: false,
      }),
      false,
    );
    assert.equal(lacksStripeSubscription({ stripeSubscriptionId: "sub_paid" }), false);
  });

  it("admin/UI: incompleto não é ATIVO nem Básico", () => {
    assert.equal(planDisplayName(null), "Sem plano");
    assert.equal(planDisplayName("PENDING"), "Sem plano");
    assert.equal(planDisplayName("INCOMPLETE"), "Sem plano");
    assert.equal(
      isAwaitingPaidCheckout({
        plan: null,
        basicoCheckoutRequired: true,
        stripeSubscriptionId: null,
        isInfluencer: false,
      }),
      true,
    );
    assert.equal(
      hasProductAccess({
        plan: null,
        basicoCheckoutRequired: true,
        stripeSubscriptionId: null,
        isInfluencer: false,
      }),
      false,
    );
  });

  it("middleware: só planos/upgrade liberados sem cookie pago", () => {
    assert.equal(isCheckoutAllowedDashboardPath("/dashboard/planos"), true);
    assert.equal(isCheckoutAllowedDashboardPath("/dashboard/planos/"), true);
    assert.equal(isCheckoutAllowedDashboardPath("/dashboard/finances"), false);
    assert.equal(isCheckoutAllowedDashboardPath("/dashboard"), false);
    assert.equal(isCheckoutAllowedDashboardPath("/dashboard/upgrade"), true);
  });
});
