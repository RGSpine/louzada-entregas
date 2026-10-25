import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFlatInterestCents,
  computeCardInstallmentBreakdown,
  formatCardInstallmentNotes,
  formatCardInstallmentPreview,
  isPurchasePaymentAmountAllowed,
  parseInterestPercent,
  resolveCardInstallmentFromForm,
} from "./card-installments";

describe("parseInterestPercent", () => {
  it("aceita vírgula e ponto", () => {
    assert.equal(parseInterestPercent("5"), 5);
    assert.equal(parseInterestPercent("2,99"), 2.99);
    assert.equal(parseInterestPercent("10%"), 10);
  });

  it("rejeita inválidos", () => {
    assert.equal(parseInterestPercent(""), null);
    assert.equal(parseInterestPercent("-1"), null);
    assert.equal(parseInterestPercent("101"), null);
  });
});

describe("applyFlatInterestCents", () => {
  it("aplica % flat e arredonda centavos", () => {
    assert.equal(applyFlatInterestCents(108_000, 0), 108_000);
    assert.equal(applyFlatInterestCents(108_000, 10), 118_800);
    // 1080 * 1.0299 = 1112.292 → 111229 cents
    assert.equal(applyFlatInterestCents(108_000, 2.99), 111_229);
  });
});

describe("computeCardInstallmentBreakdown", () => {
  it("sem juros: divide o catálogo", () => {
    const plan = computeCardInstallmentBreakdown({
      baseAmountCents: 108_000,
      installmentCount: 3,
      withInterest: false,
      interestPercent: 5,
    });
    assert.equal(plan.totalCents, 108_000);
    assert.equal(plan.withInterest, false);
    assert.deepEqual(plan.installmentCents, [36_000, 36_000, 36_000]);
  });

  it("com juros: corrige total e parcelas", () => {
    const plan = computeCardInstallmentBreakdown({
      baseAmountCents: 108_000,
      installmentCount: 3,
      withInterest: true,
      interestPercent: 10,
    });
    assert.equal(plan.totalCents, 118_800);
    assert.equal(plan.interestCents, 10_800);
    assert.equal(plan.withInterest, true);
    assert.deepEqual(plan.installmentCents, [39_600, 39_600, 39_600]);
  });

  it("distribui resto de centavos nas primeiras parcelas", () => {
    const plan = computeCardInstallmentBreakdown({
      baseAmountCents: 100_000,
      installmentCount: 3,
      withInterest: false,
      interestPercent: 0,
    });
    assert.deepEqual(plan.installmentCents, [33_334, 33_333, 33_333]);
  });
});

describe("isPurchasePaymentAmountAllowed", () => {
  it("aceita exatamente o acordado e até +100% de juros", () => {
    assert.equal(isPurchasePaymentAmountAllowed(108_000, 108_000), true);
    assert.equal(isPurchasePaymentAmountAllowed(108_000, 118_800), true);
    assert.equal(isPurchasePaymentAmountAllowed(108_000, 216_000), true);
    assert.equal(isPurchasePaymentAmountAllowed(108_000, 107_999), false);
    assert.equal(isPurchasePaymentAmountAllowed(108_000, 216_001), false);
  });
});

describe("format helpers + resolve form", () => {
  it("notas sem/com juros", () => {
    assert.equal(
      formatCardInstallmentNotes({ installmentCount: 3, withInterest: false }),
      "Cartão de crédito em 3x sem juros",
    );
    assert.equal(
      formatCardInstallmentNotes({
        installmentCount: 3,
        withInterest: true,
        interestPercent: 5,
      }),
      "Cartão de crédito em 3x com 5% de juros",
    );
  });

  it("preview legível", () => {
    const plan = computeCardInstallmentBreakdown({
      baseAmountCents: 108_000,
      installmentCount: 3,
      withInterest: true,
      interestPercent: 10,
    });
    const text = formatCardInstallmentPreview(plan);
    assert.match(text, /3×/);
    assert.match(text, /10%/);
  });

  it("resolveCardInstallmentFromForm exige % com juros", () => {
    const bad = resolveCardInstallmentFromForm({
      baseAmountCents: 108_000,
      installmentCountRaw: "3",
      interestMode: "with",
      interestPercentRaw: "",
    });
    assert.equal(bad.ok, false);

    const ok = resolveCardInstallmentFromForm({
      baseAmountCents: 108_000,
      installmentCountRaw: "3",
      interestMode: "with",
      interestPercentRaw: "5",
    });
    assert.equal(ok.ok, true);
    if (ok.ok && ok.plan) {
      assert.equal(ok.plan.totalCents, 113_400);
    }
  });

  it("sem parcelas → plan null", () => {
    const r = resolveCardInstallmentFromForm({
      baseAmountCents: 108_000,
      installmentCountRaw: "",
      interestMode: "none",
      interestPercentRaw: "",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.plan, null);
  });
});
