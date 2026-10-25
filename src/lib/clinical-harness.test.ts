import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auditClinicalFields,
  auditClinicalText,
  clinicalGenerationConfig,
  clipAtSentenceBoundary,
  collapseUngroundedAcronymExpansions,
  filterGroundedBullets,
  findUngroundedClinicalTerms,
  findWeaklySupportedSentences,
  weakSentenceWarnings,
  normalizeLlmEvolutionCoreFields,
  normalizeNotInformed,
} from "@/lib/clinical-harness";

const AMANDA_SOURCE =
  "Paciente de 1 ano e 8 meses com atraso no desenvolvimento neuropsicomotor. Iniciou fisioterapia hoje, trabalhamos CME e controle de tronco.";

describe("clinicalGenerationConfig", () => {
  it("fixa temperatura 0 e top-P 0.1 mesmo se extra tentar sobrescrever", () => {
    const cfg = clinicalGenerationConfig({ maxOutputTokens: 8192, temperature: 0.9 });
    assert.equal(cfg.temperature, 0);
    assert.equal(cfg.topP, 0.1);
    assert.equal(cfg.maxOutputTokens, 8192);
  });
});

describe("normalizeNotInformed / normalizeLlmEvolutionCoreFields", () => {
  it("converte null e placeholders em string vazia", () => {
    for (const v of [null, undefined, "Não informado", "nao mencionada.", "N/A", "null", "—", "Sem informação"]) {
      assert.equal(normalizeNotInformed(v), "", String(v));
    }
    assert.equal(normalizeNotInformed("Lombalgia (M54.5)"), "Lombalgia (M54.5)");
  });

  it("aceita null nativo do JSON nos campos centrais e preserva termos literais", () => {
    const out = normalizeLlmEvolutionCoreFields({
      nome: "Ana",
      queixa: null,
      diagnostico: ["Atraso do DNPM", "Não informado"],
      conduta: "Não informada",
      termosLiterais: ["CME", " "],
      professionalActions: [],
    });
    assert.equal(out.queixa, "");
    assert.equal(out.conduta, "");
    assert.equal(out.diagnostico, "Atraso do DNPM");
    assert.deepEqual(out.termosLiterais, ["CME"]);
    assert.deepEqual(out.professionalActions, []);
  });
});

describe("collapseUngroundedAcronymExpansions", () => {
  it("caso Amanda: remove a expansão inventada de CME", () => {
    const out = collapseUngroundedAcronymExpansions(
      "Abordagem terapêutica baseada no Conceito de Maturação Essencial (CME).",
      AMANDA_SOURCE,
    );
    assert.equal(out.text, "Abordagem terapêutica baseada no CME.");
    assert.equal(out.warnings.length, 1);
  });

  it("remove expansão entre parênteses após a sigla", () => {
    const out = collapseUngroundedAcronymExpansions("Sessão com CME (Cuevas Medek Exercises).", AMANDA_SOURCE);
    assert.equal(out.text, "Sessão com CME.");
  });

  it("mantém expansões universais e expansões ditas pelo profissional", () => {
    const src = "Rompimento de LCA no joelho direito. Usamos o método Cuevas Medek Exercises (CME).";
    const out = collapseUngroundedAcronymExpansions(
      "Ruptura do Ligamento Cruzado Anterior (LCA). Cuevas Medek Exercises (CME).",
      src,
    );
    assert.equal(out.text, "Ruptura do Ligamento Cruzado Anterior (LCA). Cuevas Medek Exercises (CME).");
    assert.equal(out.warnings.length, 0);
  });

  it("não mexe em CID-10 entre parênteses", () => {
    const out = collapseUngroundedAcronymExpansions("LCA (S83.5) confirmada.", "lesão de LCA");
    assert.equal(out.text, "LCA (S83.5) confirmada.");
  });
});

describe("findUngroundedClinicalTerms", () => {
  it("sinaliza método nomeado e sigla que não estão na fonte", () => {
    const terms = findUngroundedClinicalTerms(
      "Aplicado Conceito Bobath e escala GMFM.",
      "Paciente com atraso motor, fizemos treino de sentar.",
    );
    assert.ok(terms.some((t) => t.includes("Bobath")));
    assert.ok(terms.includes("GMFM"));
  });

  it("não sinaliza termos ditos, genéricos, títulos ou siglas estruturais", () => {
    const terms = findUngroundedClinicalTerms(
      "HISTÓRIA DA MOLÉSTIA ATUAL\nAbordagem Terapêutica com Método Pilates. HMA sem intercorrências. AVC prévio.",
      "faz pilates; teve acidente vascular cerebral ano passado",
    );
    assert.deepEqual(terms, []);
  });
});

describe("auditClinicalText / auditClinicalFields", () => {
  it("colapsa e avisa no mesmo passo", () => {
    const out = auditClinicalText("Conceito de Maturação Essencial (CME) e Método Votja.", AMANDA_SOURCE);
    assert.equal(out.text, "CME e Método Votja.");
    assert.ok(out.warnings.some((w) => w.includes("Votja")));
  });

  it("collapse-only não gera aviso de termo ausente (fonte parcial)", () => {
    const out = auditClinicalFields(
      { conduta: "Conceito de Maturação Essencial (CME). Escala GMFM." },
      "CME",
      "collapse-only",
    );
    assert.equal(out.fields.conduta, "CME. Escala GMFM.");
    assert.equal(out.warnings.length, 1);
  });

  it("fonte vazia não altera nada", () => {
    const out = auditClinicalFields({ conduta: "Conceito X (CME)" }, "  ");
    assert.equal(out.fields.conduta, "Conceito X (CME)");
  });
});

describe("filterGroundedBullets", () => {
  it("caso Amanda: tópico com metodologia inventada é corrigido ou descartado", () => {
    const { kept, dropped } = filterGroundedBullets(
      [
        "Atraso no desenvolvimento neuropsicomotor",
        "Abordagem terapêutica baseada no Conceito de Maturação Essencial (CME)",
        "Objetivo: marcha independente pelo Método Therasuit",
      ],
      AMANDA_SOURCE,
    );
    assert.deepEqual(kept, [
      "Atraso no desenvolvimento neuropsicomotor",
      "Abordagem terapêutica baseada no CME",
    ]);
    assert.equal(dropped.length, 1);
  });
});

describe("findWeaklySupportedSentences / weakSentenceWarnings", () => {
  const literal =
    "ela tá com dor nas costas embaixo faz três dias, piora quando senta muito tempo no trabalho. " +
    "fizemos liberação miofascial na lombar e alongamento de isquiotibiais, orientei compressa quente em casa.";

  it("não sinaliza paráfrase técnica fiel à fala", () => {
    const narrative =
      "Paciente refere lombalgia há três dias, com piora ao permanecer sentada por tempo prolongado no trabalho. " +
      "Realizada liberação miofascial em região lombar e alongamento de isquiotibiais. Orientada compressa quente domiciliar.";
    assert.deepEqual(findWeaklySupportedSentences(narrative, literal), []);
  });

  it("sinaliza frase inventada sem sigla nem nome próprio", () => {
    const narrative =
      "Realizada liberação miofascial em região lombar. " +
      "Objetivo terapêutico focado em ganho de estabilidade segmentar profunda com progressão para treino proprioceptivo funcional.";
    const weak = findWeaklySupportedSentences(narrative, literal);
    assert.equal(weak.length, 1);
    assert.ok(weak[0]!.startsWith("Objetivo terapêutico"));
    assert.equal(weakSentenceWarnings(narrative, literal).length, 1);
  });

  it("ignora frases curtas e fonte vazia", () => {
    assert.deepEqual(findWeaklySupportedSentences("Boa evolução hoje.", literal), []);
    assert.deepEqual(findWeaklySupportedSentences("Frase qualquer com várias palavras inventadas aqui agora", ""), []);
  });
});

describe("transcricaoLiteral no schema", () => {
  it("normaliza null e preserva o texto literal", () => {
    assert.equal(normalizeLlmEvolutionCoreFields({ transcricaoLiteral: null }).transcricaoLiteral, "");
    assert.equal(
      normalizeLlmEvolutionCoreFields({ transcricaoLiteral: "trabalhamos CME hoje" }).transcricaoLiteral,
      "trabalhamos CME hoje",
    );
  });
});

describe("clipAtSentenceBoundary", () => {
  it("não corta no meio da frase", () => {
    const text = "Primeira frase completa. Segunda frase que seria cortada no meio do raciocínio clínico.";
    const out = clipAtSentenceBoundary(text, 40);
    assert.equal(out, "Primeira frase completa. [trecho seguinte omitido]");
  });

  it("devolve o texto intacto quando cabe", () => {
    assert.equal(clipAtSentenceBoundary("Curto.", 100), "Curto.");
  });
});
