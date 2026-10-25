import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeYieldDiscount,
  yieldVoiceModelOutputSchema,
} from "./yield-voice-schema";

test("aceita oferta com desconto e série", () => {
  const parsed = yieldVoiceModelOutputSchema.safeParse({
    action: "offer",
    commands: [
      {
        itemAction: "offer",
        dateExpression: "próximas 4 terças",
        timeExpression: "10h",
        repetitions: 4,
        weekdays: [2],
        discountYield: 30,
      },
    ],
    transcriptOrSummary: "Ofertar 4 terças às 10h com 30%.",
    confidenceOverall: 0.9,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(normalizeYieldDiscount(parsed.data.commands[0]!), 30);
  }
});

test("aceita enable + set_rule no mesmo áudio", () => {
  const parsed = yieldVoiceModelOutputSchema.safeParse({
    action: "enable",
    commands: [
      { itemAction: "enable" },
      { itemAction: "set_rule", discountPercentage: 25, hoursBeforeTrigger: 12 },
    ],
    confidenceOverall: 0.85,
  });
  assert.equal(parsed.success, true);
});

test("rejeita desconto inválido", () => {
  const parsed = yieldVoiceModelOutputSchema.safeParse({
    action: "set_rule",
    commands: [{ itemAction: "set_rule", discountPercentage: 99 }],
    confidenceOverall: 0.5,
  });
  assert.equal(parsed.success, false);
});

test("book alias não existe — só ações de yield", () => {
  const parsed = yieldVoiceModelOutputSchema.safeParse({
    action: "book",
    commands: [],
  });
  assert.equal(parsed.success, false);
});
