import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canUseCheckoutCoupon } from "./coupon-eligibility";

describe("canUseCheckoutCoupon", () => {
  it("permite no cadastro e em conta incompleta (sem plano)", () => {
    assert.equal(canUseCheckoutCoupon(null), true);
    assert.equal(canUseCheckoutCoupon(undefined, true), true);
    assert.equal(canUseCheckoutCoupon("BASICO", true), true);
    assert.equal(canUseCheckoutCoupon("PROFISSIONAL", true), true);
  });

  it("bloqueia assinante já ativo (Básico/Starter/Pro)", () => {
    // Básico pago sem fromSignup: cupom só no primeiro checkout
    assert.equal(canUseCheckoutCoupon("BASICO"), false);
    assert.equal(canUseCheckoutCoupon("PROFISSIONAL"), false);
    assert.equal(canUseCheckoutCoupon("PREMIUM"), false);
  });
});
