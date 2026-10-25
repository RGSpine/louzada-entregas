import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveMonthlyEvolutionCount,
  getPlanUsageWarnings,
  PLAN_USAGE_NEAR_LIMIT_RATIO,
} from "./plan-usage-banner";

describe("plan-usage-banner", () => {
  it("zera contagem de evoluções quando mudou o mês UTC", () => {
    const lastMonth = new Date(Date.UTC(2026, 4, 15));
    assert.equal(effectiveMonthlyEvolutionCount(12, lastMonth, new Date(Date.UTC(2026, 5, 1))), 0);
  });

  it("avisa FREE perto do limite de evoluções", () => {
    const warnings = getPlanUsageWarnings("BASICO", {
      evolutionsUsedThisMonth: 18,
      evolutionsLimit: 20,
      patientsUsed: 2,
      patientsLimit: 10,
      documentsUsedThisMonth: 1,
      documentsLimit: 5,
    });
    assert.ok(warnings.some((w) => w.kind === "evolutions" && !w.atLimit));
  });

  it("marca limite esgotado de documentos no FREE", () => {
    const warnings = getPlanUsageWarnings("BASICO", {
      evolutionsUsedThisMonth: 0,
      evolutionsLimit: 20,
      patientsUsed: 0,
      patientsLimit: 10,
      documentsUsedThisMonth: 5,
      documentsLimit: 5,
    });
    const doc = warnings.find((w) => w.kind === "documents");
    assert.ok(doc?.atLimit);
  });

  it("PRO não gera avisos", () => {
    const warnings = getPlanUsageWarnings("PREMIUM", {
      evolutionsUsedThisMonth: 999,
      evolutionsLimit: Infinity,
      patientsUsed: 999,
      patientsLimit: Infinity,
      documentsUsedThisMonth: null,
      documentsLimit: null,
    });
    assert.equal(warnings.length, 0);
  });

  it("Consultório/Clínica não geram avisos (limites Premium)", () => {
    const usage = {
      evolutionsUsedThisMonth: 100,
      evolutionsLimit: 20,
      patientsUsed: 100,
      patientsLimit: 10,
      documentsUsedThisMonth: 5,
      documentsLimit: 5,
    };
    assert.deepEqual(getPlanUsageWarnings("CONSULTORIO", usage), []);
    assert.deepEqual(getPlanUsageWarnings("CLINICA", usage), []);
  });

  it("usa ratio configurável", () => {
    assert.equal(PLAN_USAGE_NEAR_LIMIT_RATIO, 0.85);
  });
});
