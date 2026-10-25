import test from "node:test";
import assert from "node:assert/strict";
import { detectAgendaFinanceChatTriggers } from "./agenda-finance-chat-triggers";

test("detectAgendaFinanceChatTriggers: agenda por termos explícitos", () => {
  const r = detectAgendaFinanceChatTriggers("Qual a próxima consulta na agenda?");
  assert.equal(r.wantsAgendaContext, true);
  assert.equal(r.wantsFinanceContext, false);
});

test("detectAgendaFinanceChatTriggers: financeiro por pagamento/pacote", () => {
  const r = detectAgendaFinanceChatTriggers("Quantas sessões pendentes do pacote ele ainda tem?");
  assert.equal(r.wantsAgendaContext, false);
  assert.equal(r.wantsFinanceContext, true);
});

test("detectAgendaFinanceChatTriggers: ambos quando pergunta cruza", () => {
  const r = detectAgendaFinanceChatTriggers(
    "Na agenda, a consulta de amanhã já foi paga via PIX?",
  );
  assert.equal(r.wantsAgendaContext, true);
  assert.equal(r.wantsFinanceContext, true);
});

test("detectAgendaFinanceChatTriggers: clínico puro não dispara", () => {
  const r = detectAgendaFinanceChatTriggers("Resuma as últimas evoluções e conduta atual.");
  assert.equal(r.wantsAgendaContext, false);
  assert.equal(r.wantsFinanceContext, false);
});
