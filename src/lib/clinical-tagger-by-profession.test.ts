import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { professionOptions } from "@/lib/profession-options";
import {
  getClinicalTaggingInstruction,
  listProfessionTaggerCoverage,
} from "@/lib/clinical-tagger-by-profession";
import { normalizeToUmbrella } from "@/lib/clinical-taxonomy";

describe("resolveClinicalTaggerFamily — dropdown completo", () => {
  const expected: Record<string, string> = {
    "Cirurgiao-Dentista": "odontologia",
    Enfermeiro: "enfermagem",
    Estudante: "generico",
    Fisioterapeuta: "fisioterapia_reab",
    Fonoaudiologo: "fonoaudiologia",
    Medico: "nutricao_medicina",
    Nutricionista: "nutricao_medicina",
    "Educacao-Fisica": "fisioterapia_reab",
    Psicologo: "psicologia",
    "Terapeuta-Ocupacional": "fisioterapia_reab",
    Veterinario: "veterinaria",
  };

  it("cobre todos os values de professionOptions", () => {
    const coverage = listProfessionTaggerCoverage();
    assert.equal(coverage.length, professionOptions.length);
    for (const row of coverage) {
      assert.equal(
        row.family,
        expected[row.value],
        `${row.value} (${row.label}) → esperado ${expected[row.value]}, veio ${row.family}`,
      );
    }
  });

  it("instruções LLM citam termos da área (não só fisioterapia)", () => {
    const psico = getClinicalTaggingInstruction("Psicologo");
    assert.match(psico, /Depressao|Ansiedade|TDAH/);

    const nutri = getClinicalTaggingInstruction("Nutricionista");
    assert.match(nutri, /Obesidade|Diabetes|Hipertensao/);

    const fono = getClinicalTaggingInstruction("Fonoaudiologo");
    assert.match(fono, /Disfonia|Disfagia/);

    const odonto = getClinicalTaggingInstruction("Cirurgiao-Dentista");
    assert.match(odonto, /Carie|Periodontal|DTM/);

    const enf = getClinicalTaggingInstruction("Enfermeiro");
    assert.match(enf, /Lesao por Pressao|Sepse|Infeccao/);

    const edu = getClinicalTaggingInstruction("Educacao-Fisica");
    assert.match(edu, /Tendinopatia|Lombalgia/);

    const to = getClinicalTaggingInstruction("Terapeuta-Ocupacional");
    assert.match(to, /Fisioterapia|Terapia Ocupacional|Tendinopatia/);
  });
});

describe("normalizeToUmbrella multiprofissional", () => {
  it("psicologia / nutrição / fono / odonto / enfermagem", () => {
    assert.equal(normalizeToUmbrella("Transtorno depressivo maior"), "Depressao");
    assert.equal(normalizeToUmbrella("DM2 descompensado"), "Diabetes");
    assert.equal(normalizeToUmbrella("Nódulo vocal bilateral"), "Disfonia");
    assert.equal(normalizeToUmbrella("Periodontite crônica"), "Doenca Periodontal");
    assert.equal(normalizeToUmbrella("Úlcera por pressão estágio II"), "Lesao por Pressao");
    assert.equal(normalizeToUmbrella("Dermatite atópica canina"), "Dermatopatia");
  });

  it("não confunde texto genérico com Esclerose via chave 'em'", () => {
    assert.notEqual(normalizeToUmbrella("sistema musculoesqueletico"), "Esclerose Multipla");
    assert.equal(normalizeToUmbrella("Esclerose múltipla remitente"), "Esclerose Multipla");
  });
});
