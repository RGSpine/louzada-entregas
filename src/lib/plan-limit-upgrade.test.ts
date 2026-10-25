import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectPlanLimitKindFromError,
  getPlanLimitUpgradeCopy,
  suggestedUpgradePlan,
} from "./plan-limit-upgrade";

describe("plan-limit-upgrade", () => {
  it("Básico sobe para Profissional; Profissional sobe para Premium", () => {
    assert.equal(suggestedUpgradePlan("BASICO"), "PROFISSIONAL");
    assert.equal(suggestedUpgradePlan("PROFISSIONAL"), "PREMIUM");
  });

  it("Consultório/Clínica sugerem Premium no CTA (já têm bucket Premium)", () => {
    assert.equal(suggestedUpgradePlan("CONSULTORIO"), "PREMIUM");
    assert.equal(suggestedUpgradePlan("CLINICA"), "PREMIUM");
  });

  it("detecta tipo de limite a partir da mensagem do servidor", () => {
    assert.equal(
      detectPlanLimitKindFromError("Limite de evoluções atingido. Faça upgrade."),
      "evolutions",
    );
    assert.equal(
      detectPlanLimitKindFromError("Limite de pacientes atingido."),
      "patients",
    );
  });

  it("mensagem de evoluções menciona PDF quando aplicável", () => {
    const copy = getPlanLimitUpgradeCopy("evolutions", "BASICO", {
      pdfGenerated: true,
    });
    assert.match(copy.message, /PDF foi gerado/);
    assert.match(copy.message, /Profissional/);
  });

  it("mensagem de documentos cita limite Básico e upgrade", () => {
    const copy = getPlanLimitUpgradeCopy("documents", "BASICO");
    assert.match(copy.message, /5 documentos/);
    assert.equal(copy.targetPlan, "PROFISSIONAL");
  });
});
