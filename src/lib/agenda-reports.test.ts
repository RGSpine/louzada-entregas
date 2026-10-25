import test from "node:test";
import assert from "node:assert/strict";
import { classifyReportByKeywords } from "./agenda-reports";

test("classifica quantos pacientes amanhã", () => {
  assert.equal(classifyReportByKeywords("quantos pacientes amanhã"), "tomorrow_count");
});

test("classifica nomes amanhã", () => {
  assert.equal(classifyReportByKeywords("quais os nomes amanhã"), "tomorrow_names");
});

test("classifica última semana", () => {
  assert.equal(classifyReportByKeywords("quantos atendi na última semana"), "last_week_attended");
});

test("classifica último mês", () => {
  assert.equal(classifyReportByKeywords("quantos atendi no último mês"), "last_month_attended");
});

test("retorna null para texto irrelevante", () => {
  assert.equal(classifyReportByKeywords("agendar michel segunda"), null);
});
