import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attendanceDateToSaoPauloNoon,
  extractInstallmentCount,
  formatPaymentNotes,
  inferPortuguesePayment,
  normalizePaymentMethodToken,
  yyyyMmDdToSaoPauloNoon,
} from "./portuguese-payment";

describe("normalizePaymentMethodToken", () => {
  it("aceita enums e aliases pt-BR", () => {
    assert.equal(normalizePaymentMethodToken("PIX"), "PIX");
    assert.equal(normalizePaymentMethodToken("dinheiro"), "CASH");
    assert.equal(normalizePaymentMethodToken("crédito"), "CARD");
    assert.equal(normalizePaymentMethodToken("cartão de crédito"), "CARD");
    assert.equal(normalizePaymentMethodToken("débito"), "CARD");
    assert.equal(normalizePaymentMethodToken("transferência"), "TRANSFER");
  });
});

describe("extractInstallmentCount", () => {
  it("lê Nx e vezes por extenso", () => {
    assert.equal(extractInstallmentCount("pagou no crédito em 5x"), 5);
    assert.equal(extractInstallmentCount("parcelado em oito vezes"), 8);
    assert.equal(extractInstallmentCount("cartão em 3 parcelas"), 3);
    assert.equal(extractInstallmentCount("crédito em três vezes"), 3);
    assert.equal(extractInstallmentCount("PIX à vista"), null);
  });
});

describe("inferPortuguesePayment", () => {
  it("une crédito + parcelas do áudio", () => {
    const g = inferPortuguesePayment({
      text: "paciente pagou no crédito parcelado em cinco vezes",
    });
    assert.equal(g.method, "CARD");
    assert.equal(g.cardKind, "CREDIT");
    assert.equal(g.installmentCount, 5);
    assert.equal(formatPaymentNotes(g), "Cartão de crédito em 5x");
  });

  it("prioriza token da IA e completa parcelas do texto", () => {
    const g = inferPortuguesePayment({
      methodToken: "crédito",
      text: "foi em 8x",
    });
    assert.equal(g.method, "CARD");
    assert.equal(g.installmentCount, 8);
  });

  it("detecta PIX no texto quando a IA omite method", () => {
    const g = inferPortuguesePayment({ text: "recebi 400 no pix ontem" });
    assert.equal(g.method, "PIX");
    assert.equal(g.installmentCount, null);
  });
});

describe("yyyyMmDdToSaoPauloNoon", () => {
  it("mantém o dia civil em SP", () => {
    const d = yyyyMmDdToSaoPauloNoon("2026-07-08");
    assert.ok(d);
    // ISO deve refletir -03:00 (ou -02 no horário de verão legado — SP fixo -03 desde 2019)
    assert.match(d!.toISOString(), /^2026-07-08T15:00:00/);
  });
});

describe("attendanceDateToSaoPauloNoon", () => {
  it("aceita dd/MM/aaaa e yyyy-MM-dd sem deslocar o dia", () => {
    const br = attendanceDateToSaoPauloNoon("30/09/2026");
    const iso = attendanceDateToSaoPauloNoon("2026-09-30");
    assert.ok(br);
    assert.ok(iso);
    assert.match(br!.toISOString(), /^2026-09-30T15:00:00/);
    assert.equal(br!.toISOString(), iso!.toISOString());
  });

  it("rejeita vazio ou inválido", () => {
    assert.equal(attendanceDateToSaoPauloNoon(""), null);
    assert.equal(attendanceDateToSaoPauloNoon("ontem"), null);
  });
});
