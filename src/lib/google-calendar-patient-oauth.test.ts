import test from "node:test";
import assert from "node:assert/strict";
import {
  signPatientGoogleOAuthState,
  verifyPatientGoogleOAuthState,
} from "./google-calendar-patient-oauth";

test("state OAuth do paciente valida e expira", () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-patient-gcal";
  const now = 1_700_000_000_000;
  const state = signPatientGoogleOAuthState("pat_123", now);
  assert.deepEqual(verifyPatientGoogleOAuthState(state, now + 1000), {
    ok: true,
    patientId: "pat_123",
  });
  assert.equal(verifyPatientGoogleOAuthState(state, now + 11 * 60 * 1000).ok, false);
  assert.equal(verifyPatientGoogleOAuthState(`${state}x`, now).ok, false);
  assert.equal(verifyPatientGoogleOAuthState("nope", now).ok, false);
});
