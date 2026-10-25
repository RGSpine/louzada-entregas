import test from "node:test";
import assert from "node:assert/strict";
import { classifyB2cOrchestratorRisk } from "./orchestrator-risk";
import { managerDraftNeedsDeepSeekRefine } from "./manager-refine-policy";
import { matchCanonicalProductFaq } from "./canonical-faq";

test("R2: falta de ar / dor no peito", () => {
  const r = classifyB2cOrchestratorRisk("Estou com falta de ar e dor no peito");
  assert.equal(r.risk, "R2");
  assert.equal(r.intent, "emergency");
});

test("R0: tarefas / próximo retorno", () => {
  const r = classifyB2cOrchestratorRisk("Qual meu próximo retorno?");
  assert.equal(r.risk, "R0");
  assert.equal(r.wantsTasksOrSchedule, true);
  assert.equal(r.wantsProfessional, false);
});

test("R0: exame agendado não vira R1 clínico", () => {
  const r = classifyB2cOrchestratorRisk("Quando é meu próximo exame?");
  assert.equal(r.risk, "R0");
  assert.equal(r.wantsTasksOrSchedule, true);
});

test("R0: vitrine / fisioterapeuta", () => {
  const r = classifyB2cOrchestratorRisk("Quero marcar com um fisioterapeuta");
  assert.equal(r.risk, "R0");
  assert.equal(r.wantsProfessional, true);
});

test("R0: FAQ produto", () => {
  const r = classifyB2cOrchestratorRisk("O assessor substitui uma consulta?");
  assert.equal(r.risk, "R0");
  assert.equal(r.wantsProductFaq, true);
  assert.ok(matchCanonicalProductFaq("O assessor substitui uma consulta?"));
});

test("R1: sintomas clínicos", () => {
  const r = classifyB2cOrchestratorRisk("Tenho dor lombar há 3 dias, o que pode ser?");
  assert.equal(r.risk, "R1");
  assert.equal(r.intent, "clinical");
});

test("R1 + profissional quando pede indicação com sintoma", () => {
  const r = classifyB2cOrchestratorRisk(
    "Estou com dor no ombro, indica um fisioterapeuta?",
  );
  assert.equal(r.risk, "R1");
  assert.equal(r.wantsProfessional, true);
});

test("DeepSeek condicional: routine com ids = false", () => {
  assert.equal(
    managerDraftNeedsDeepSeekRefine(
      {
        symptoms: [],
        specialtyHints: [],
        urgency: "routine",
        suggestedProfileIds: ["abc"],
      },
      true,
    ),
    false,
  );
});

test("DeepSeek condicional: urgência = true mesmo sem catálogo", () => {
  assert.equal(
    managerDraftNeedsDeepSeekRefine(
      {
        symptoms: ["dor"],
        specialtyHints: [],
        urgency: "urgent_care_advice",
        suggestedProfileIds: [],
      },
      false,
    ),
    true,
  );
});

test("DeepSeek condicional: hints sem ids + catálogo = true", () => {
  assert.equal(
    managerDraftNeedsDeepSeekRefine(
      {
        symptoms: ["dor"],
        specialtyHints: ["fisioterapia"],
        urgency: "routine",
        suggestedProfileIds: [],
      },
      true,
    ),
    true,
  );
});
