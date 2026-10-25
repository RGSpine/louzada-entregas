import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateClinicalProfile,
  extractUmbrellaFromEvolutionContent,
  resolveCaseDefinitionLabel,
  resolveEvolutionClinicalTags,
} from "@/lib/clinical-profile-tags";

describe("resolveEvolutionClinicalTags", () => {
  it("prioriza clinicalMeta.diagnostico e agrupa em termo guarda-chuva", () => {
    const tags = resolveEvolutionClinicalTags({
      clinicalMeta: {
        diagnostico: "Tendinopatia reativa do supraespinhal",
        regiao: "Ombro",
      },
      patientDiagnosis: "Lombalgia",
    });
    assert.deepEqual(tags, ["Tendinopatia"]);
  });

  it("usa diagnóstico da sessão quando meta está vazia", () => {
    const tags = resolveEvolutionClinicalTags({
      clinicalMeta: {},
      patientDiagnosis: "Entorse de tornozelo grau II",
    });
    assert.deepEqual(tags, ["Lesao Ligamentar"]);
  });

  it("usa diagnóstico persistido do paciente como fallback", () => {
    const tags = resolveEvolutionClinicalTags({
      storedPatientDiagnosis: "Lombalgia mecânica crônica",
    });
    assert.deepEqual(tags, ["Lombalgia"]);
  });

  it("extrai do texto da evolução sem alterar o conteúdo", () => {
    const content =
      "EVOLUÇÃO\nPaciente em melhora.\n\nDIAGNÓSTICO:\nFascite plantar bilateral\n\nCONDUTA:\nExercícios.";
    const tags = resolveEvolutionClinicalTags({ evolutionContent: content });
    assert.deepEqual(tags, ["Fasciopatia Plantar"]);
    assert.match(content, /Fascite plantar/);
  });
});

describe("extractUmbrellaFromEvolutionContent", () => {
  it("ignora textos sem diagnóstico clínico reconhecível", () => {
    assert.equal(
      extractUmbrellaFromEvolutionContent("Paciente compareceu e relatou melhora."),
      null,
    );
  });
});

describe("resolveCaseDefinitionLabel", () => {
  it("retorna guarda-chuva a partir do meta", () => {
    assert.equal(
      resolveCaseDefinitionLabel({ diagnostico: "Hernia de disco L4-L5" }),
      "Discopatia",
    );
  });
});

describe("aggregateClinicalProfile", () => {
  it("agrega top 5 e usa foco do mês quando houver tags no mês", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const snapshot = aggregateClinicalProfile(
      [
        {
          tags: ["Tendinopatia"],
          date: new Date("2026-07-02T12:00:00.000Z"),
        },
        {
          tags: ["Tendinopatia"],
          date: new Date("2026-07-10T12:00:00.000Z"),
        },
        {
          tags: ["Lombalgia"],
          date: new Date("2026-01-05T12:00:00.000Z"),
        },
        {
          tags: ["Lombalgia"],
          date: new Date("2026-02-05T12:00:00.000Z"),
        },
        {
          tags: ["Lombalgia"],
          date: new Date("2026-03-05T12:00:00.000Z"),
        },
      ],
      now,
    );

    assert.equal(snapshot.mostFrequentTag, "Tendinopatia");
    assert.equal(snapshot.monthTagCount, 2);
    assert.equal(snapshot.totalTags, 5);
    assert.equal(snapshot.topTags[0]?.tag, "Lombalgia");
    assert.equal(snapshot.topTags[0]?.count, 3);
  });

  it("recupera tag de clinicalMeta quando tags estão vazias", () => {
    const snapshot = aggregateClinicalProfile([
      {
        tags: [],
        clinicalMeta: { diagnostico: "Bursite trocanterica" },
        date: new Date("2026-07-01T12:00:00.000Z"),
      },
    ]);
    assert.equal(snapshot.totalTags, 1);
    assert.equal(snapshot.topTags[0]?.tag, "Bursite");
  });
});
