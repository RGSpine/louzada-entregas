import test from "node:test";
import assert from "node:assert/strict";
import {
  getEasterSundayGregorian,
  isBrazilNationalHoliday,
  listBrazilNationalHolidays,
} from "./brazil-national-holidays";

test("Páscoa 2025 (20 de abril)", () => {
  const e = getEasterSundayGregorian(2025);
  assert.equal(e.month, 4);
  assert.equal(e.day, 20);
});

test("Páscoa 2026 (5 de abril)", () => {
  const e = getEasterSundayGregorian(2026);
  assert.equal(e.month, 4);
  assert.equal(e.day, 5);
});

test("Corpus Christi 2025 a 60 dias da Páscoa (19 de junho)", () => {
  const list = listBrazilNationalHolidays(2025, "America/Sao_Paulo");
  const corpus = list.find((h) => h.name.startsWith("Corpus"));
  assert.equal(corpus?.date, "2025-06-19");
});

test("1 de janeiro é feriado nacional", () => {
  assert.equal(isBrazilNationalHoliday("2026-01-01", "America/Sao_Paulo"), true);
});

test("Tiradentes 21 de abril", () => {
  const list = listBrazilNationalHolidays(2026, "America/Sao_Paulo");
  assert.ok(list.some((h) => h.date === "2026-04-21" && h.name.includes("Tiradentes")));
});
