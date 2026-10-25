import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isGenderNameVariation,
  matchSimilarPatients,
  normalizePatientName,
} from "@/lib/similar-patient-match";

const rodolfo = {
  id: "p1",
  name: "Rodolfo",
  age: "24 anos",
  diagnosis: null,
  evolutionCount: 2,
};

const lorenzoSilva = {
  id: "p2",
  name: "Lorenzo Silva",
  age: null,
  diagnosis: "LCA",
  evolutionCount: 1,
};

const roberta = {
  id: "p3",
  name: "Roberta",
  age: null,
  diagnosis: null,
  evolutionCount: 0,
};

describe("similar-patient-match", () => {
  it("normaliza acentos e caixa", () => {
    assert.equal(normalizePatientName("  José  "), "jose");
  });

  it("detecta match exato (Rodolfo)", () => {
    const hits = matchSimilarPatients("Rodolfo", [rodolfo, lorenzoSilva]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, "p1");
  });

  it("detecta primeiro nome igual com sobrenome extra", () => {
    const hits = matchSimilarPatients("Lorenzo", [lorenzoSilva]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.name, "Lorenzo Silva");
  });

  it("detecta typo leve no primeiro nome", () => {
    const hits = matchSimilarPatients("Lorenso", [lorenzoSilva]);
    assert.equal(hits.length, 1);
  });

  it("nao alerta variacao de genero Roberto/Roberta", () => {
    assert.equal(isGenderNameVariation("Roberto", "Roberta"), true);
    const hits = matchSimilarPatients("Roberto", [roberta]);
    assert.equal(hits.length, 0);
  });
});
