import test from "node:test";
import assert from "node:assert/strict";
import { appointmentIntervalsOverlap } from "./appointment-availability";

test("intervalos adjacentes não colidem [10,11) e [11,12)", () => {
  const a0 = new Date("2026-05-04T10:00:00.000Z");
  const a1 = new Date("2026-05-04T11:00:00.000Z");
  const b0 = new Date("2026-05-04T11:00:00.000Z");
  const b1 = new Date("2026-05-04T12:00:00.000Z");
  assert.equal(appointmentIntervalsOverlap(a0, a1, b0, b1), false);
});

test("sobreposição parcial", () => {
  const a0 = new Date("2026-05-04T10:00:00.000Z");
  const a1 = new Date("2026-05-04T11:30:00.000Z");
  const b0 = new Date("2026-05-04T11:00:00.000Z");
  const b1 = new Date("2026-05-04T12:00:00.000Z");
  assert.equal(appointmentIntervalsOverlap(a0, a1, b0, b1), true);
});

test("contido", () => {
  const outer0 = new Date("2026-05-04T09:00:00.000Z");
  const outer1 = new Date("2026-05-04T13:00:00.000Z");
  const inner0 = new Date("2026-05-04T10:00:00.000Z");
  const inner1 = new Date("2026-05-04T11:00:00.000Z");
  assert.equal(appointmentIntervalsOverlap(outer0, outer1, inner0, inner1), true);
});
