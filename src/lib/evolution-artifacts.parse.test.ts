import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVOLUTION_ARTIFACTS_VERSION,
  mergeClinicalContinuationArtifacts,
  parseAndSanitizeEvolutionArtifacts,
} from "@/lib/evolution-artifacts";

describe("parseAndSanitizeEvolutionArtifacts", () => {
  it("aceita actions como strings e handout aninhado", () => {
    const result = parseAndSanitizeEvolutionArtifacts({
      hasProfessionalActions: "true",
      professionalActions: ["Marcar retorno em 15 dias", { label: "Solicitar RM", type: "schedule_exam" }],
      patientHandout: {
        summary: "Cuidados em casa",
        bullets: ["Gelo 15 min", "Evitar carga"],
      },
      hasPatientEducation: false,
    });
    assert.equal(result.professionalActions?.items.length, 2);
    assert.equal(result.professionalActions?.items[0]?.label, "Marcar retorno em 15 dias");
    assert.equal(result.patientHandout?.summary, "Cuidados em casa");
    assert.deepEqual(result.patientHandout?.bullets, ["Gelo 15 min", "Evitar carga"]);
  });

  it("nao zera handout quando um action item e invalido", () => {
    const result = parseAndSanitizeEvolutionArtifacts({
      professionalActions: [{ type: "custom" }, { label: "Encaminhar ortopedia", type: "referral" }],
      patientHandoutBullets: ["Procurar PS se dor intensa"],
      patientHandoutSummary: "Sinais de alerta",
      medicationsAndSupplements: [{ name: "" }, { name: "Losartana", kind: "medication" }],
    });
    assert.equal(result.professionalActions?.items.length, 1);
    assert.equal(result.patientHandout?.bullets.length, 1);
    assert.equal(result.medicationsAndSupplements?.items.length, 1);
  });

  it("aceita aliases em portugues (orientacoes / pontosDeAcao)", () => {
    const result = parseAndSanitizeEvolutionArtifacts({
      pontosDeAcao: [{ acao: "Reavaliar EVA", tipo: "custom", prazo: "proxima sessao" }],
      orientacoes: ["Repouso relativo 48h"],
    });
    assert.equal(result.professionalActions?.items[0]?.label, "Reavaliar EVA");
    assert.equal(result.professionalActions?.items[0]?.dueHint, "proxima sessao");
    assert.deepEqual(result.patientHandout?.bullets, ["Repouso relativo 48h"]);
  });
});

describe("mergeClinicalContinuationArtifacts", () => {
  it("mantém itens anteriores e acrescenta só o que a IA trouxe de novo", () => {
    const merged = mergeClinicalContinuationArtifacts(
      {
        professionalActions: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          items: [{ label: "Solicitar ressonância" }],
        },
        patientHandout: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          bullets: ["Evitar carga na primeira semana"],
        },
        medicationsAndSupplements: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          items: [{ name: "Losartana", dose: "100 mg" }],
        },
      },
      {
        professionalActions: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          items: [{ label: "Marcar retorno em 15 dias" }],
        },
        patientHandout: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          summary: "Cuidados em casa",
          bullets: ["Gelo 15 min"],
        },
        medicationsAndSupplements: {
          v: EVOLUTION_ARTIFACTS_VERSION,
          items: [{ name: "Losartana", dose: "50 mg", frequency: "1x ao dia" }],
        },
      },
    );

    assert.deepEqual(
      merged.professionalActions.items.map((item) => item.label),
      ["Solicitar ressonância", "Marcar retorno em 15 dias"],
    );
    assert.deepEqual(merged.patientHandout.bullets, [
      "Evitar carga na primeira semana",
      "Gelo 15 min",
    ]);
    assert.equal(merged.patientHandout.summary, "Cuidados em casa");
    assert.equal(merged.medicationsAndSupplements.items.length, 1);
    assert.equal(merged.medicationsAndSupplements.items[0]?.dose, "100 mg");
    assert.equal(merged.medicationsAndSupplements.items[0]?.frequency, "1x ao dia");
  });
});
