import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectServiceBillingModeFromText,
  formatMonthlyMidPeriodWarning,
  isMonthlyPlanMidPeriod,
  resolveMonthlyPeriodBounds,
} from "./service-billing-mode";

describe("detectServiceBillingModeFromText", () => {
  it("detecta mensalidade em nome/descrição", () => {
    assert.equal(detectServiceBillingModeFromText("Pilates — mensalidade"), "MONTHLY");
    assert.equal(
      detectServiceBillingModeFromText("Acompanhamento nutricional", "Valor mensal R$ 400"),
      "MONTHLY",
    );
    assert.equal(detectServiceBillingModeFromText("Plano mensal studio"), "MONTHLY");
  });

  it("mantém SESSION para pacote de N sessões", () => {
    assert.equal(detectServiceBillingModeFromText("Plano de 12 sessões"), "SESSION");
    assert.equal(
      detectServiceBillingModeFromText("RPG", "pacote 8 atendimentos à vista"),
      "SESSION",
    );
  });

  it("default SESSION sem keywords", () => {
    assert.equal(detectServiceBillingModeFromText("Consulta avulsa"), "SESSION");
  });
});

describe("monthly period mid warning", () => {
  it("resolve mês civil SP e marca segunda metade", () => {
    const { periodStart, periodEnd } = resolveMonthlyPeriodBounds(
      new Date("2026-10-05T15:00:00.000Z"),
    );
    assert.ok(periodStart < periodEnd);
    assert.equal(
      isMonthlyPlanMidPeriod({
        periodStart,
        periodEnd,
        now: new Date("2026-10-05T15:00:00.000Z"),
      }),
      false,
    );
    assert.equal(
      isMonthlyPlanMidPeriod({
        periodStart,
        periodEnd,
        now: new Date("2026-10-20T15:00:00.000Z"),
      }),
      true,
    );
    assert.match(
      formatMonthlyMidPeriodWarning({
        patientName: "Ana",
        serviceName: "Pilates",
        periodEnd,
      }),
      /Ana.*mensalidade.*Pilates/i,
    );
  });
});
