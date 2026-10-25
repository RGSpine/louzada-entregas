import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  yieldConfigSchema,
  yieldOfferWindowSchema,
} from "@/lib/marketplace/yield-schema";

describe("yieldConfigSchema", () => {
  it("aceita a regra de 30% em 24h", () => {
    const parsed = yieldConfigSchema.safeParse({
      enabled: true,
      hoursBeforeTrigger: 24,
      discountPercentage: 30,
    });
    assert.equal(parsed.success, true);
  });

  it("rejeita desconto acima de 90% e horas zeradas", () => {
    assert.equal(
      yieldConfigSchema.safeParse({
        enabled: true,
        hoursBeforeTrigger: 0,
        discountPercentage: 30,
      }).success,
      false,
    );
    assert.equal(
      yieldConfigSchema.safeParse({
        enabled: true,
        hoursBeforeTrigger: 24,
        discountPercentage: 95,
      }).success,
      false,
    );
  });
});

describe("yieldOfferWindowSchema", () => {
  it("aceita janela semanal com dias", () => {
    const parsed = yieldOfferWindowSchema.safeParse({
      recurrence: "WEEKLY",
      weekdays: [1, 3, 5],
      startMinute: 480,
      endMinute: 1080,
    });
    assert.equal(parsed.success, true);
  });

  it("exige data em ONCE e weekday em WEEKLY", () => {
    assert.equal(
      yieldOfferWindowSchema.safeParse({
        recurrence: "WEEKLY",
        weekdays: [],
        startMinute: 480,
        endMinute: 600,
      }).success,
      false,
    );
    assert.equal(
      yieldOfferWindowSchema.safeParse({
        recurrence: "ONCE",
        weekdays: [],
        startMinute: 480,
        endMinute: 600,
      }).success,
      false,
    );
    assert.equal(
      yieldOfferWindowSchema.safeParse({
        recurrence: "ONCE",
        weekdays: [],
        startMinute: 480,
        endMinute: 600,
        specificDate: "2026-10-01",
      }).success,
      true,
    );
  });
});
