import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundPatientIntake } from "@/lib/b2c/patient-audio-grounding";
import {
  applyPanoramaRejection,
  buildPatientConsultationReview,
  buildPatientPanoramaReview,
} from "@/lib/b2c/patient-clinical-review";

const source =
  "O doutor Paulo, cardiologista, pediu para tomar losartana 50 mg e marcar retorno. Falou CME na lombar.";

describe("groundPatientIntake", () => {
  it("remove expansão de sigla e método que não estão na gravação", () => {
    const { draft, warnings } = groundPatientIntake(
      {
        translatedExplanation:
          "O cardiologista Paulo pediu losartana. Citou Conceito de Maturação Essencial (CME) na lombar.",
        professionalName: "Paulo",
        specialty: "cardiologista",
        recommendations: ["Tomar losartana 50 mg", "Iniciar Método Inventado Silva"],
        attentionPoints: [],
        orientations: ["Marcar retorno"],
        panoramaSnippet: "Em uso de losartana, com retorno a marcar.",
        tasks: [
          { title: "Tomar losartana 50 mg", type: "MEDICATION" },
          { title: "Iniciar Protocolo Aurora Prime", type: "OTHER" },
        ],
      },
      source,
    );
    assert.match(draft.translatedExplanation, /CME/);
    assert.doesNotMatch(draft.translatedExplanation, /Maturação Essencial/);
    assert.equal(draft.professionalName, "Paulo");
    assert.deepEqual(draft.recommendations, ["Tomar losartana 50 mg"]);
    assert.equal(draft.tasks.length, 1);
    assert.ok(warnings.length > 0);
  });

  it("anula especialidade que não foi dita", () => {
    const { draft } = groundPatientIntake(
      {
        translatedExplanation: "Pediu retorno.",
        professionalName: "Dra. Inventada",
        specialty: "neurologia",
        recommendations: [],
        attentionPoints: [],
        orientations: [],
        panoramaSnippet: null,
        tasks: [],
      },
      "Pediu retorno em duas semanas.",
    );
    assert.equal(draft.specialty, null);
    assert.equal(draft.professionalName, null);
  });
});

describe("revisão manual do paciente", () => {
  const editedAt = new Date("2026-10-16T12:00:00.000Z");

  it("guarda recomendação apagada para não voltar", () => {
    const { structured } = buildPatientConsultationReview({
      previous: {
        professionalName: "Paulo",
        specialty: "cardiologista",
        recommendations: ["Tomar losartana 50 mg", "Fazer ressonância inventada"],
        attentionPoints: [],
        orientations: [],
        panoramaSnippet: null,
      },
      previousRejected: [],
      nextExplanation: "O doutor Paulo pediu losartana.",
      nextRecommendations: ["Tomar losartana 50 mg"],
      nextAttentionPoints: [],
      nextOrientations: [],
      nextProfessionalName: "Paulo",
      nextSpecialty: "cardiologista",
      editedAt,
    });
    assert.deepEqual(structured.recommendations, ["Tomar losartana 50 mg"]);
    assert.ok(
      structured.review?.rejected.some((item) => item.includes("ressonância")),
    );
  });

  it("tira do panorama novo a frase que o paciente apagou", () => {
    const { review } = buildPatientPanoramaReview({
      previousPanorama: "Usa losartana. Tem diagnóstico de fibromialgia inventada.",
      previousRejected: [],
      nextPanorama: "Usa losartana.",
      editedAt,
    });
    const next = applyPanoramaRejection(
      "Usa losartana. Tem diagnóstico de fibromialgia inventada.",
      review.rejected,
    );
    assert.equal(next, "Usa losartana.");
  });
});
