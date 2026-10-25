import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_ARTIFACTS_VERSION } from "@/lib/evolution-artifacts";
import {
  buildEvolutionCopyPreview,
  clinicalMetaFromEvolutionJson,
  ensureEvolutionCopyDraftArtifacts,
  evolutionRowToCopyDraft,
  formatEvolutionCopyDateLabel,
  mergeFormFieldsIntoClinicalMeta,
  splitEvolutionContentSections,
  buildClinicalContinuationExistingContent,
} from "@/lib/evolution-copy-draft";

describe("evolution-copy-draft", () => {
  it("formata data pt-BR", () => {
    const label = formatEvolutionCopyDateLabel(new Date("2026-06-15T12:00:00.000Z"));
    assert.match(label, /15\/06\/2026/);
  });

  it("trunca preview longo", () => {
    const preview = buildEvolutionCopyPreview("a".repeat(300));
    assert.ok(preview.endsWith("…"));
    assert.ok(preview.length <= 220);
  });

  it("retorna null para conteúdo e artefactos vazios", () => {
    assert.equal(
      evolutionRowToCopyDraft({
        id: "evo_1",
        date: new Date(),
        content: "   ",
      }),
      null,
    );
  });

  it("monta draft com preview e conteúdo sanitizado", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_1",
      date: new Date("2026-06-15T12:00:00.000Z"),
      content: "Queixa principal\n\nConduta",
    });
    assert.ok(draft);
    assert.equal(draft!.evolutionId, "evo_1");
    assert.match(draft!.content, /Queixa principal/);
    assert.ok(draft!.preview.length > 0);
    assert.equal(draft!.professionalActions.v, EVOLUTION_ARTIFACTS_VERSION);
    assert.equal(draft!.professionalActions.items.length, 0);
    assert.equal(draft!.patientHandout.bullets.length, 0);
    assert.equal(draft!.medicationsAndSupplements.items.length, 0);
  });

  it("transporta Pontos de Ação e Orientações da última evolução", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_2",
      date: new Date("2026-06-15T12:00:00.000Z"),
      content: "Evolução clínica",
      professionalActions: {
        v: 1,
        items: [
          {
            label: "Marcar retorno em 15 dias",
            type: "schedule_exam",
            priority: "high",
          },
        ],
      },
      patientHandout: {
        v: 1,
        summary: "Cuidados em casa",
        bullets: ["Gelo 15 min", "Evitar carga"],
      },
      clinicalMeta: { diagnostico: "Entorse tornozelo", anatomia: "tornozelo" },
    });
    assert.ok(draft);
    assert.equal(draft!.professionalActions.items.length, 1);
    assert.equal(draft!.professionalActions.items[0]!.label, "Marcar retorno em 15 dias");
    assert.equal(draft!.patientHandout.summary, "Cuidados em casa");
    assert.deepEqual(draft!.patientHandout.bullets, ["Gelo 15 min", "Evitar carga"]);
    assert.equal(draft!.clinicalMeta?.diagnostico, "Entorse tornozelo");
  });

  it("aceita draft só com artefactos (sem texto)", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_3",
      date: new Date(),
      content: "",
      professionalActions: {
        v: 1,
        items: [{ label: "Solicitar relato de dor", type: "message" }],
      },
    });
    assert.ok(draft);
    assert.equal(draft!.content, "");
    assert.equal(draft!.professionalActions.items.length, 1);
  });

  it("clinicalMetaFromEvolutionJson ignora valores não-string", () => {
    assert.equal(clinicalMetaFromEvolutionJson(null), undefined);
    assert.deepEqual(clinicalMetaFromEvolutionJson({ a: "ok", b: 1 }), { a: "ok" });
  });

  it("transporta Medicamentos & Suplementos da última evolução", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_meds",
      date: new Date("2026-06-15T12:00:00.000Z"),
      content: "Evolução clínica",
      medicationsAndSupplements: {
        v: 1,
        summary: "Em uso contínuo",
        items: [
          {
            name: "Losartana",
            kind: "medication",
            dose: "50 mg",
            frequency: "1x/dia",
            effects: "controle pressórico",
          },
        ],
      },
    });
    assert.ok(draft);
    assert.equal(draft!.medicationsAndSupplements.items.length, 1);
    assert.equal(draft!.medicationsAndSupplements.items[0]!.name, "Losartana");
    assert.equal(draft!.medicationsAndSupplements.summary, "Em uso contínuo");
  });

  it("separa exames do content e restaura campos de formulário do clinicalMeta", () => {
    const split = splitEvolutionContentSections(
      "Corpo clínico\n\n---\n\nEXAMES COMPLEMENTARES:\nRM joelho\n\n---\n\nMEDICAMENTOS E SUPLEMENTOS:\nIgnorar",
    );
    assert.equal(split.body, "Corpo clínico");
    assert.match(split.examsAnalysis, /RM joelho/);

    const meta = mergeFormFieldsIntoClinicalMeta(
      { diagnostico: "Tendinopatia", regiao: "Joelho" },
      {
        queixa: "Dor ao subir escada",
        conduta: "Exercícios excêntricos",
        diagnostico: "Tendinopatia Insercional do Tendão Patelar (M76.5)",
      },
    );
    assert.equal(meta?.diagnostico, "Tendinopatia");
    assert.equal(meta?.formQueixa, "Dor ao subir escada");
    assert.equal(meta?.formConduta, "Exercícios excêntricos");
    assert.equal(
      meta?.formDiagnostico,
      "Tendinopatia Insercional do Tendão Patelar (M76.5)",
    );

    const draft = evolutionRowToCopyDraft({
      id: "evo_form",
      date: new Date("2026-08-04T12:00:00.000Z"),
      content:
        "Texto base\n\n---\n\nEXAMES COMPLEMENTARES:\nUSG tendão patelar",
      clinicalMeta: meta,
      professionalActions: {
        v: 1,
        items: [{ label: "Reavaliar EVA", type: "custom" }],
      },
      patientHandout: {
        v: 1,
        summary: "Evitar impacto",
        bullets: ["Gelo 15 min"],
      },
    });
    assert.ok(draft);
    assert.equal(draft!.content, "Texto base");
    assert.match(draft!.examsAnalysis, /USG/);
    assert.equal(draft!.queixa, "Dor ao subir escada");
    assert.equal(draft!.conduta, "Exercícios excêntricos");
    assert.equal(
      draft!.diagnostico,
      "Tendinopatia Insercional do Tendão Patelar (M76.5)",
    );
    assert.equal(draft!.professionalActions.items.length, 1);
    assert.equal(draft!.patientHandout.summary, "Evitar impacto");
  });

  it("mergeFormFields preserva formQueixa/formConduta quando campos são omitidos", () => {
    const existing = mergeFormFieldsIntoClinicalMeta(
      { diagnostico: "Tendinopatia" },
      {
        queixa: "Dor ao subir escada",
        conduta: "Exercícios excêntricos",
        diagnostico: "Tendinopatia Insercional",
      },
    );
    const preserved = mergeFormFieldsIntoClinicalMeta(existing, {
      // simula save mobile/API sem patientQueixa/patientConduta/patientDiagnosis
    });
    assert.equal(preserved?.formQueixa, "Dor ao subir escada");
    assert.equal(preserved?.formConduta, "Exercícios excêntricos");
    assert.equal(preserved?.formDiagnostico, "Tendinopatia Insercional");
    assert.equal(preserved?.diagnostico, "Tendinopatia");

    const cleared = mergeFormFieldsIntoClinicalMeta(existing, {
      queixa: "",
      conduta: "   ",
    });
    assert.equal(cleared?.formQueixa, undefined);
    assert.equal(cleared?.formConduta, undefined);
    assert.equal(cleared?.formDiagnostico, "Tendinopatia Insercional");
  });

  it("extrai conduta legada do corpo quando clinicalMeta não tem formConduta", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_legacy",
      date: new Date("2026-06-29T12:00:00.000Z"),
      content:
        "realizou artroplastia. Atualmente, a paciente relata boa melhora. A conduta atual visa o reforço da capacidade muscular da paciente, com exercícios de fortalecimento e resistência de força. Não foram observadas outras intercorrências.",
      clinicalMeta: { diagnostico: "Pós-Operatório", regiao: "Ombro" },
      professionalActions: {
        v: 1,
        items: [{ label: "Planejar fortalecimento", type: "custom" }],
      },
    });
    assert.ok(draft);
    assert.match(draft!.conduta, /reforço da capacidade muscular/i);
    assert.equal(draft!.diagnostico, "Pós-Operatório");
    // «boa melhora» não deve virar queixa
    assert.equal(draft!.queixa, "");
  });

  it("transporta Orientações mesmo com patientHandout legado sem v ou bullets sujos", () => {
    const draftMissingV = evolutionRowToCopyDraft({
      id: "evo_handout_legacy",
      date: new Date("2026-08-01T12:00:00.000Z"),
      content: "Corpo clínico",
      patientHandout: {
        summary: "Cuidados em casa",
        bullets: ["Gelo 15 min", "", null, "Evitar carga"],
      } as unknown,
    });
    assert.ok(draftMissingV);
    assert.equal(draftMissingV!.patientHandout.summary, "Cuidados em casa");
    assert.deepEqual(draftMissingV!.patientHandout.bullets, [
      "Gelo 15 min",
      "Evitar carga",
    ]);

    const draftStringV = evolutionRowToCopyDraft({
      id: "evo_handout_vstr",
      date: new Date("2026-08-01T12:00:00.000Z"),
      content: "Corpo",
      patientHandout: {
        v: "1",
        bullets: ["Repouso relativo"],
      } as unknown,
    });
    assert.ok(draftStringV);
    assert.deepEqual(draftStringV!.patientHandout.bullets, ["Repouso relativo"]);
  });

  it("transporta Medicamentos mesmo com itens sujos ou kind inválido", () => {
    const draft = evolutionRowToCopyDraft({
      id: "evo_meds_dirty",
      date: new Date("2026-08-01T12:00:00.000Z"),
      content: "Corpo clínico",
      medicationsAndSupplements: {
        summary: "Em uso",
        items: [
          { name: "Losartana", kind: "medication", dose: "50 mg" },
          { name: "", kind: "medication" },
          { name: "Vitamina D", kind: "not-a-kind" },
          null,
        ],
      } as unknown,
    });
    assert.ok(draft);
    assert.equal(draft!.medicationsAndSupplements.summary, "Em uso");
    assert.equal(draft!.medicationsAndSupplements.items.length, 2);
    assert.equal(draft!.medicationsAndSupplements.items[0]!.name, "Losartana");
    assert.equal(draft!.medicationsAndSupplements.items[1]!.name, "Vitamina D");
    assert.equal(draft!.medicationsAndSupplements.items[1]!.kind, undefined);
  });

  it("monta continuação clínica sem valor pago", () => {
    const text = buildClinicalContinuationExistingContent({
      queixa: "Dor lombar",
      diagnostico: "Lombalgia",
      conduta: "Alongamento",
      content: "EVA 4/10. Pagou no Pix 200 reais.",
      examsAnalysis: "",
    });
    assert.match(text, /Dor lombar/);
    assert.match(text, /EVA 4\/10/);
    assert.doesNotMatch(text, /Pix|reais/i);
  });

  it("leva pontos de ação, orientações e medicamentos para a continuação", () => {
    const text = buildClinicalContinuationExistingContent({
      queixa: "",
      diagnostico: "",
      conduta: "",
      content: "Mantém dor lombar.",
      examsAnalysis: "",
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
        summary: "",
        items: [{ name: "Losartana", dose: "50 mg", frequency: "1x ao dia" }],
      },
    });
    assert.match(text, /Marcar retorno em 15 dias/);
    assert.match(text, /Gelo 15 min/);
    assert.match(text, /Losartana/);
    assert.match(text, /50 mg/);
  });

  it("ensureEvolutionCopyDraftArtifacts preenche artefactos ausentes", () => {
    const { professionalActions, patientHandout, medicationsAndSupplements } =
      ensureEvolutionCopyDraftArtifacts({});
    assert.equal(professionalActions.v, EVOLUTION_ARTIFACTS_VERSION);
    assert.equal(professionalActions.items.length, 0);
    assert.equal(patientHandout.bullets.length, 0);
    assert.equal(medicationsAndSupplements.items.length, 0);
  });
});
