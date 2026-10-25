import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildManualClinicalReview,
  dropRejectedItems,
  isSameClinicalItem,
  parseClinicalCaseHighlightsReviewMeta,
  parseClinicalCaseHighlightsStored,
} from "@/lib/clinical-case-highlights";

const editedAt = new Date("2026-10-15T12:00:00.000Z");

describe("isSameClinicalItem", () => {
  it("ignora acentos, caixa e pontuação", () => {
    assert.equal(isSameClinicalItem("Lombalgia crônica.", "lombalgia cronica"), true);
  });

  it("reconhece reescrita com as mesmas palavras-chave", () => {
    assert.equal(
      isSameClinicalItem(
        "Síndrome do túnel do carpo à direita",
        "Síndrome túnel do carpo direita, confirmada",
      ),
      true,
    );
  });

  it("não confunde itens clínicos distintos", () => {
    assert.equal(isSameClinicalItem("Lombalgia crônica", "Cervicalgia aguda pós-trauma"), false);
    assert.equal(isSameClinicalItem("", "Lombalgia"), false);
  });
});

describe("dropRejectedItems", () => {
  it("remove itens rejeitados mesmo reescritos pela IA", () => {
    const out = dropRejectedItems(
      ["Uso de CME sem prescrição", "Dor lombar há 3 meses"],
      ["Uso de CME (concentrado de hemácias) sem prescrição"],
    );
    assert.deepEqual(out, ["Dor lombar há 3 meses"]);
  });

  it("mantém tudo quando não há rejeitados", () => {
    assert.deepEqual(dropRejectedItems(["A", "B"], []), ["A", "B"]);
  });
});

describe("buildManualClinicalReview", () => {
  it("registra tópicos e frases removidos como rejeitados", () => {
    const { stored, summary } = buildManualClinicalReview({
      previousBullets: ["Dor lombar há 3 meses", "Diabetes tipo 2 em uso de metformina"],
      previousSummary: "Paciente com dor lombar. Diabético em uso de metformina.",
      previousRejected: [],
      nextBullets: ["Dor lombar há 3 meses"],
      nextSummary: "Paciente com dor lombar.",
      editedAt,
    });
    assert.equal(summary, "Paciente com dor lombar.");
    assert.deepEqual(stored.bullets, ["Dor lombar há 3 meses"]);
    assert.equal(stored.userEditedAt, editedAt.toISOString());
    assert.deepEqual(stored.rejected, [
      "Diabetes tipo 2 em uso de metformina",
      "Diabético em uso de metformina.",
    ]);
  });

  it("tira de rejeitados o item que o profissional readicionou", () => {
    const { stored } = buildManualClinicalReview({
      previousBullets: ["Dor lombar há 3 meses"],
      previousSummary: "",
      previousRejected: ["Diabetes tipo 2 em uso de metformina"],
      nextBullets: ["Dor lombar há 3 meses", "Diabetes tipo 2 em uso de metformina"],
      nextSummary: "",
      editedAt,
    });
    assert.equal(stored.rejected, undefined);
    assert.equal(stored.bullets.length, 2);
  });

  it("pequena correção de termo não rejeita o tópico corrigido", () => {
    const { stored } = buildManualClinicalReview({
      previousBullets: ["Tendinopatia do supraespinhal no ombro direito"],
      previousSummary: "",
      previousRejected: [],
      nextBullets: ["Tendinopatia do supraespinhal no ombro esquerdo"],
      nextSummary: "",
      editedAt,
    });
    assert.equal(stored.rejected, undefined);
  });

  it("persiste a revisão mesmo sem tópicos restantes", () => {
    const { stored } = buildManualClinicalReview({
      previousBullets: ["Item inventado pela IA"],
      previousSummary: "",
      previousRejected: [],
      nextBullets: [],
      nextSummary: "",
      editedAt,
    });
    assert.equal(parseClinicalCaseHighlightsStored(stored), undefined);
    const meta = parseClinicalCaseHighlightsReviewMeta(stored);
    assert.equal(meta.userEditedAt, editedAt.toISOString());
    assert.deepEqual(meta.rejected, ["Item inventado pela IA"]);
  });
});
