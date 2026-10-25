import test from "node:test";
import assert from "node:assert/strict";
import { resolveResourceFromGuess } from "./resolve-resource-name";

const rooms = [
  { id: "s1", name: "Sala de Pilates" },
  { id: "s2", name: "Maca de Quiropraxia" },
];

test("casa nome de sala ignorando acento e caixa", () => {
  const hit = resolveResourceFromGuess("sala de pilates", rooms);
  assert.equal(hit?.id, "s1");
});

test("casa por substring falada", () => {
  const hit = resolveResourceFromGuess("Pilates", rooms);
  assert.equal(hit?.id, "s1");
});

test("devolve null quando não há recurso", () => {
  assert.equal(resolveResourceFromGuess("sala azul", rooms), null);
  assert.equal(resolveResourceFromGuess(null, rooms), null);
});
