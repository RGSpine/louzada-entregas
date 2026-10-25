import test from "node:test";
import assert from "node:assert/strict";
import { snapTimeValue, shiftTimeValue } from "./agenda-time-edit";

test("snapTimeValue arredonda 10:02 para 10:00 com step 5", () => {
  assert.equal(snapTimeValue("10:02", 5), "10:00");
  assert.equal(snapTimeValue("10:03", 5), "10:05");
  assert.equal(snapTimeValue("10:07", 5), "10:05");
});

test("shiftTimeValue avança e recua minutos", () => {
  assert.equal(shiftTimeValue("10:00", 15), "10:15");
  assert.equal(shiftTimeValue("10:00", -30), "09:30");
});
