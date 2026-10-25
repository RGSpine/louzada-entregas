import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldBlockSameDayAutoConsume } from "./evolution-consume-same-day";

describe("shouldBlockSameDayAutoConsume", () => {
  it("bloqueia só quando a evolução veio de uma marcação (par agenda+ficha)", () => {
    assert.equal(shouldBlockSameDayAutoConsume({ appointmentId: "appt_1" }), true);
    assert.equal(shouldBlockSameDayAutoConsume({ appointmentId: "  " }), false);
    assert.equal(shouldBlockSameDayAutoConsume({ appointmentId: null }), false);
    assert.equal(shouldBlockSameDayAutoConsume({}), false);
  });
});
