import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentCardSurfaceClasses,
  appointmentGridFillClasses,
  resolveConfirmationStatusFromGuess,
} from "./appointment-confirmation";
import { AppointmentConfirmationStatus } from "@prisma/client";

test("resolveConfirmationStatusFromGuess assume amarelo por defeito", () => {
  assert.equal(
    resolveConfirmationStatusFromGuess(undefined),
    AppointmentConfirmationStatus.PENDING_CONFIRMATION,
  );
  assert.equal(
    resolveConfirmationStatusFromGuess(null),
    AppointmentConfirmationStatus.PENDING_CONFIRMATION,
  );
});

test("resolveConfirmationStatusFromGuess aceita confirmado explícito", () => {
  assert.equal(
    resolveConfirmationStatusFromGuess("CONFIRMED"),
    AppointmentConfirmationStatus.CONFIRMED,
  );
});

test("appointmentCardSurfaceClasses usa tokens warning/success só com feature ligada", () => {
  assert.match(
    appointmentCardSurfaceClasses(AppointmentConfirmationStatus.PENDING_CONFIRMATION, true),
    /warning/,
  );
  assert.match(
    appointmentCardSurfaceClasses(AppointmentConfirmationStatus.CONFIRMED, true),
    /success/,
  );
  assert.match(appointmentCardSurfaceClasses(AppointmentConfirmationStatus.CONFIRMED, false), /muted/);
});

test("appointmentGridFillClasses não aplica border/ring (só fundo)", () => {
  const pending = appointmentGridFillClasses(
    AppointmentConfirmationStatus.PENDING_CONFIRMATION,
    true,
  );
  assert.match(pending, /warning/);
  assert.doesNotMatch(pending, /border|ring/);
  const confirmed = appointmentGridFillClasses(AppointmentConfirmationStatus.CONFIRMED, true);
  assert.match(confirmed, /success/);
  assert.doesNotMatch(confirmed, /border|ring/);
});
