import test from "node:test";
import assert from "node:assert/strict";
import { classifyProOrchestratorRisk } from "./pro-risk";
import { dailyTokenLimitForPlan } from "./token-budget";
import { validateExtractedStructure } from "./pipeline";
import { z } from "zod";

test("pro R0: agenda por termos", () => {
  const d = classifyProOrchestratorRisk("Qual a próxima consulta na agenda?");
  assert.equal(d.risk, "R0");
  assert.equal(d.intent, "agenda_finance");
  assert.equal(d.skipEvidence, true);
  assert.equal(d.route, "Modelo_Economico");
});

test("pro R0: lookup de prontuário", () => {
  const d = classifyProOrchestratorRisk("Liste os medicamentos já registrados");
  assert.equal(d.risk, "R0");
  assert.equal(d.intent, "chart_lookup");
  assert.equal(d.skipEvidence, true);
});

test("pro R0: FAQ Ester", () => {
  const d = classifyProOrchestratorRisk("O que é a Ester?");
  assert.equal(d.risk, "R0");
  assert.equal(d.intent, "product_faq");
});

test("pro R1: evidência / conduta", () => {
  const d = classifyProOrchestratorRisk(
    "O que dizem as diretrizes sobre conduta nesse diagnóstico?",
  );
  assert.equal(d.risk, "R1");
  assert.equal(d.skipEvidence, false);
  assert.equal(d.route, "Modelo_Avancado");
});

test("pro R1: pedido de exame arquivo", () => {
  const d = classifyProOrchestratorRisk("Analise o exame de imagem anexado");
  assert.equal(d.risk, "R1");
  assert.equal(d.intent, "exam_file");
});

test("pro R2: emergência", () => {
  const d = classifyProOrchestratorRisk("Paciente com dor no peito e falta de ar");
  assert.equal(d.risk, "R2");
  assert.equal(d.intent, "emergency");
});

test("token budget: Premium > Profissional > Básico", () => {
  const b = dailyTokenLimitForPlan("BASICO");
  const p = dailyTokenLimitForPlan("PROFISSIONAL");
  const pr = dailyTokenLimitForPlan("PREMIUM");
  assert.ok(b < p && p < pr);
});

test("pipeline validateExtractedStructure", () => {
  const schema = z.object({ a: z.string() });
  const ok = validateExtractedStructure<{ a: string }>(schema, { a: "x" });
  assert.equal(ok.ok, true);
  const bad = validateExtractedStructure(schema, { a: 1 });
  assert.equal(bad.ok, false);
});
