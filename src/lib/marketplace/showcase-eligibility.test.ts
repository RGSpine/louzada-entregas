import assert from "node:assert/strict";
import test from "node:test";
import { isShowcaseEligibleProfession } from "./showcase-eligibility.ts";

test("estudante fica fora da vitrine", () => {
  assert.equal(isShowcaseEligibleProfession("Estudante"), false);
  assert.equal(isShowcaseEligibleProfession(" estudante "), false);
  assert.equal(isShowcaseEligibleProfession("Fisioterapeuta"), true);
  assert.equal(isShowcaseEligibleProfession(""), false);
  assert.equal(isShowcaseEligibleProfession(null), false);
});
