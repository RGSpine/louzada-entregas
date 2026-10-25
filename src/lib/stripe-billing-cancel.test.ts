import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOpenBillingSubscriptionStatus,
  isTerminalBillingSubscriptionStatus,
  resolveUserFacingPrimaryOutcome,
  shouldCancelSubscriptionImmediately,
  shouldClearLocalPlanAfterCancel,
  shouldCollectSubscriptionForCancel,
} from "@/lib/stripe-billing-cancel";

describe("isOpenBillingSubscriptionStatus", () => {
  it("inclui incomplete (1.ª fatura ainda pode completar)", () => {
    assert.equal(isOpenBillingSubscriptionStatus("incomplete"), true);
    assert.equal(isOpenBillingSubscriptionStatus("active"), true);
    assert.equal(isOpenBillingSubscriptionStatus("trialing"), true);
  });

  it("exclui canceled e incomplete_expired", () => {
    assert.equal(isOpenBillingSubscriptionStatus("canceled"), false);
    assert.equal(isOpenBillingSubscriptionStatus("incomplete_expired"), false);
  });
});

describe("shouldCollectSubscriptionForCancel", () => {
  it("não coleta canceled/incomplete_expired mesmo com cancel_at_period_end residual", () => {
    assert.equal(shouldCollectSubscriptionForCancel("canceled"), false);
    assert.equal(shouldCollectSubscriptionForCancel("incomplete_expired"), false);
    assert.equal(isTerminalBillingSubscriptionStatus("canceled"), true);
    assert.equal(isTerminalBillingSubscriptionStatus("incomplete_expired"), true);
  });

  it("coleta active/trialing (cancel_at_period_end é irrelevante na coleta)", () => {
    assert.equal(shouldCollectSubscriptionForCancel("active"), true);
    assert.equal(shouldCollectSubscriptionForCancel("trialing"), true);
  });
});

describe("shouldCancelSubscriptionImmediately", () => {
  it("account_delete sempre cancela já", () => {
    assert.equal(shouldCancelSubscriptionImmediately("account_delete", "trialing"), true);
    assert.equal(shouldCancelSubscriptionImmediately("account_delete", "active"), true);
    assert.equal(shouldCancelSubscriptionImmediately("account_delete", "incomplete"), true);
  });

  it("subscription_cancel: trial, incomplete e inadimplência imediatos", () => {
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "trialing"), true);
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "incomplete"), true);
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "past_due"), true);
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "unpaid"), true);
  });

  it("subscription_cancel: paused também encerra já (evita cobrança residual)", () => {
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "paused"), true);
  });

  it("subscription_cancel: active pago agenda fim de período", () => {
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "active"), false);
  });

  it("subscription_cancel: canceled/incomplete_expired NÃO são immediate (nem devem agendar)", () => {
    assert.equal(shouldCancelSubscriptionImmediately("subscription_cancel", "canceled"), false);
    assert.equal(
      shouldCancelSubscriptionImmediately("subscription_cancel", "incomplete_expired"),
      false,
    );
  });
});

describe("shouldClearLocalPlanAfterCancel", () => {
  it("primary scheduled mantém plano mesmo com leftovers cancelados", () => {
    assert.equal(shouldClearLocalPlanAfterCancel("scheduled", 2, 1), false);
  });

  it("primary canceled limpa plano", () => {
    assert.equal(shouldClearLocalPlanAfterCancel("canceled", 1, 0), true);
  });

  it("primary canceled + leftover agendado NÃO limpa plano (acesso até fim do período)", () => {
    assert.equal(shouldClearLocalPlanAfterCancel("canceled", 1, 1), false);
  });

  it("sem primary: só limpa se cancelou tudo e nada agendado", () => {
    assert.equal(shouldClearLocalPlanAfterCancel("none", 1, 0), true);
    assert.equal(shouldClearLocalPlanAfterCancel("none", 1, 1), false);
  });
});

describe("resolveUserFacingPrimaryOutcome", () => {
  it("sem subscriptionId + leftovers agendados → scheduled (não none)", () => {
    assert.equal(resolveUserFacingPrimaryOutcome(null, "none", 0, 1), "scheduled");
  });

  it("sem subscriptionId + só cancelados → canceled", () => {
    assert.equal(resolveUserFacingPrimaryOutcome(null, "none", 2, 0), "canceled");
  });

  it("primary morto (canceled) + leftover agendado → scheduled", () => {
    assert.equal(resolveUserFacingPrimaryOutcome("sub_dead", "canceled", 0, 1), "scheduled");
  });

  it("primary missing/unchanged + leftovers cancelados → canceled", () => {
    assert.equal(resolveUserFacingPrimaryOutcome("sub_stale", "missing", 1, 0), "canceled");
    assert.equal(resolveUserFacingPrimaryOutcome("sub_x", "unchanged", 2, 0), "canceled");
  });

  it("primary canceled sem leftovers → canceled", () => {
    assert.equal(resolveUserFacingPrimaryOutcome("sub_x", "canceled", 1, 0), "canceled");
  });
});
