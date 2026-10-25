import test from "node:test";
import assert from "node:assert/strict";
import { formatSuggestedSlotsMessage } from "./appointment-suggested-slots";

test("formatSuggestedSlotsMessage vazio", () => {
  assert.equal(formatSuggestedSlotsMessage([]), "");
});

test("formatSuggestedSlotsMessage com slots", () => {
  const msg = formatSuggestedSlotsMessage([
    {
      startUtc: new Date(),
      endUtc: new Date(),
      label: "23/05 14:00",
    },
    {
      startUtc: new Date(),
      endUtc: new Date(),
      label: "23/05 15:00",
    },
  ]);
  assert.match(msg, /Horários livres sugeridos/);
  assert.match(msg, /23\/05 14:00/);
  assert.match(msg, /23\/05 15:00/);
});
