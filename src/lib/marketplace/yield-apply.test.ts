import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDiscountPrice,
  hoursUntilSlot,
  selectActiveYieldRule,
} from "@/lib/marketplace/yield-apply";

const RULE_24 = { id: "r24", hoursBeforeTrigger: 24, discountPercentage: 30 };
const RULE_6 = { id: "r6", hoursBeforeTrigger: 6, discountPercentage: 50 };

describe("yield-apply", () => {
  it("escolhe a regra de 24h quando faltam 20h", () => {
    const rule = selectActiveYieldRule(20, [RULE_24, RULE_6]);
    assert.equal(rule?.id, "r24");
  });

  it("escolhe o maior desconto quando várias regras já dispararam", () => {
    const rule = selectActiveYieldRule(5, [RULE_24, RULE_6]);
    assert.equal(rule?.id, "r6");
    assert.equal(rule?.discountPercentage, 50);
  });

  it("não liga yield se o horário ainda está longe demais", () => {
    assert.equal(selectActiveYieldRule(25, [RULE_24, RULE_6]), null);
  });

  it("não liga yield para horário no passado", () => {
    assert.equal(selectActiveYieldRule(-1, [RULE_24]), null);
  });

  it("calcula desconto e horas até o slot", () => {
    assert.equal(computeDiscountPrice(150, 30), 105);
    const now = new Date("2026-09-26T12:00:00.000Z");
    const slot = new Date("2026-09-26T18:00:00.000Z");
    assert.equal(hoursUntilSlot(slot, now), 6);
  });
});
