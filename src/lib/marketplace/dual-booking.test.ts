import assert from "node:assert/strict";
import test from "node:test";
import { dualStatusFromAppointment, parseConversationSlot } from "./dual-booking.ts";

test("cancelar ou faltar encerra o vínculo dos dois lados", () => {
  assert.equal(dualStatusFromAppointment("CANCELLED", "CONFIRMED"), "CANCELLED");
  assert.equal(dualStatusFromAppointment("NO_SHOW", "CONFIRMED"), "CANCELLED");
});

test("confirmar de um lado confirma o vínculo", () => {
  assert.equal(dualStatusFromAppointment("SCHEDULED", "CONFIRMED"), "CONFIRMED");
  assert.equal(dualStatusFromAppointment("COMPLETED", "PENDING_CONFIRMATION"), "CONFIRMED");
  assert.equal(dualStatusFromAppointment("SCHEDULED", "PENDING_CONFIRMATION"), "PENDING");
});

test("horário da conversa é lido no fuso de São Paulo", () => {
  const start = parseConversationSlot("2026-10-20T14:30");
  assert.equal(start?.toISOString(), "2026-10-20T17:30:00.000Z");
  assert.equal(parseConversationSlot("amanha"), null);
});
