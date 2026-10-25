import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAwaitingPaidCheckout,
  needsBasicoCheckout,
  PENDING_CHECKOUT_LIMITS,
} from "./basico-plan";
import {
  canAddPatient,
  canCreateEvolution,
  getPlanLimits,
  isProfissionalOrAbove,
} from "./plan-limits";
import { planDisplayName } from "./plan-tier";

describe("pré-pagamento (PENDING) — segurança de acesso", () => {
  const pendingUser = {
    plan: "PENDING",
    basicoCheckoutRequired: true,
    stripeSubscriptionId: null as string | null,
    isInfluencer: false,
  };

  it("needsBasicoCheckout bloqueia PENDING", () => {
    assert.equal(needsBasicoCheckout(pendingUser), true);
    assert.equal(isAwaitingPaidCheckout(pendingUser), true);
  });

  it("limites zerados — não cria evolução nem paciente", () => {
    const limits = getPlanLimits("PENDING");
    assert.deepEqual(limits, PENDING_CHECKOUT_LIMITS);
    assert.equal(canCreateEvolution("PENDING", 0), false);
    assert.equal(canAddPatient("PENDING", 0), false);
  });

  it("features pagas negadas em PENDING", () => {
    assert.equal(isProfissionalOrAbove("PENDING"), false);
    assert.equal(isProfissionalOrAbove("PROFISSIONAL"), true);
  });

  it("admin/exibição não mascara PENDING/null como Básico", () => {
    assert.equal(planDisplayName("PENDING"), "Sem plano");
    assert.equal(planDisplayName(null), "Sem plano");
    assert.equal(planDisplayName("INCOMPLETE"), "Sem plano");
    assert.equal(planDisplayName("BASICO"), "Básico");
  });

  it("assinante Stripe libera acesso mesmo com flag residual", () => {
    assert.equal(
      needsBasicoCheckout({
        ...pendingUser,
        plan: "BASICO",
        stripeSubscriptionId: "sub_paid",
        basicoCheckoutRequired: true,
      }),
      false,
    );
    assert.equal(canCreateEvolution("BASICO", 0), true);
  });
});
