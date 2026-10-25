import assert from "node:assert/strict";
import test from "node:test";
import { censusBars, censusPlaceLabel } from "./showcase-census.ts";

test("agrupa a mesma área ignorando acento", () => {
  const bars = censusBars(["Médico", "medico", "Médico", "Fisioterapeuta"]);
  assert.deepEqual(bars, [
    { label: "Médico", count: 3 },
    { label: "Fisioterapeuta", count: 1 },
  ]);
});

test("soma o excedente em Outras", () => {
  const bars = censusBars(["A", "B", "C"], 2);
  assert.equal(bars.length, 3);
  assert.equal(bars[2]?.label, "Outras");
  assert.equal(bars[2]?.count, 1);
});

test("cidade e estado formam a região", () => {
  assert.equal(censusPlaceLabel({ city: "Ribeirão Preto", state: "SP" }), "Ribeirão Preto · SP");
  assert.equal(censusPlaceLabel({ neighborhood: "Olaia", state: "SP" }), "Olaia · SP");
  assert.equal(censusPlaceLabel({}), null);
});
