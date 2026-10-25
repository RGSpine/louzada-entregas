import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  postProcessEvolutionTranscriptionFields,
  sanitizeTechnicalNarrative,
  stripFinancialMentionsFromClinicalText,
} from "@/lib/evolution-transcription-sanitize";

describe("sanitizeTechnicalNarrative", () => {
  it("remove título e bloco IDENTIFICAÇÃO antes da HMA", () => {
    const raw = `EVOLUÇÃO FISIOTERAPÊUTICA
IDENTIFICAÇÃO:
Paciente, 34 anos, sexo masculino, praticante amador de CrossFit e corrida de rua.

HISTÓRIA DA MOLÉSTIA ATUAL (HMA):
Paciente em pós-operatório de reconstrução do LCA há 12 semanas.`;

    const out = sanitizeTechnicalNarrative(raw, "Marcelo de Nogueira", "34 anos");
    assert.match(out, /HISTÓRIA DA MOLÉSTIA ATUAL/i);
    assert.doesNotMatch(out, /EVOLUÇÃO FISIOTERAPÊUTICA/i);
    assert.doesNotMatch(out, /IDENTIFICAÇÃO/i);
    assert.doesNotMatch(out, /sexo masculino/i);
    assert.doesNotMatch(out, /CrossFit/i);
  });

  it("remove linha inicial Paciente, X anos", () => {
    const out = sanitizeTechnicalNarrative(
      "Paciente, 42 anos, relata dor lombar há três semanas.",
      "Ana",
      "42 anos",
    );
    assert.match(out, /relata dor lombar/i);
    assert.doesNotMatch(out, /^Paciente,\s*42 anos/i);
  });
});

describe("stripFinancialMentionsFromClinicalText", () => {
  it("remove «valor pago» e R$ mas mantém menção a N sessões", () => {
    const out = stripFinancialMentionsFromClinicalText(
      "A paciente iniciou um plano de tratamento de quatro sessões de fisioterapia, com a primeira sessão já realizada e o valor pago.",
    );
    assert.match(out, /quatro sessões/i);
    assert.doesNotMatch(out, /valor pago/i);
    assert.doesNotMatch(out, /R\$/i);
  });

  it("não remove EVA (escala de dor)", () => {
    const out = stripFinancialMentionsFromClinicalText(
      "Dor em EVA 2/10 em repouso. Conduta mantida.",
    );
    assert.match(out, /EVA 2\/10/);
  });

  it("remove «pagou no Pix» e montante em reais sem R$", () => {
    const out = stripFinancialMentionsFromClinicalText(
      "Iniciou plano de 8 sessões, pagou no Pix 600 reais. Conduta: alongamento.",
    );
    assert.match(out, /8 sessões/i);
    assert.match(out, /alongamento/i);
    assert.doesNotMatch(out, /pagou|Pix|600\s*reais/i);
  });

  it("remove «ainda não pagou» sem apagar a sessão clínica", () => {
    const out = stripFinancialMentionsFromClinicalText(
      "Realizou a 3ª sessão do plano, ainda não pagou. Progresso satisfatório.",
    );
    assert.match(out, /3ª sessão/i);
    assert.match(out, /Progresso satisfatório/i);
    assert.doesNotMatch(out, /não pagou|nao pagou/i);
  });
});

describe("postProcessEvolutionTranscriptionFields", () => {
  it("alinha campos e remove financeiro", () => {
    const data = postProcessEvolutionTranscriptionFields({
      technicalTranscription:
        "Iniciou plano de 4 sessões. Valor pago via Pix R$ 600,00.",
    });
    assert.doesNotMatch(data.technicalTranscription ?? "", /valor pago|R\$|Pix/i);
    assert.match(data.technicalTranscription ?? "", /4 sessões/i);
    assert.equal(data.technicalTranscription, data.transcricao_corrigida);
  });
});
