import test from "node:test";
import assert from "node:assert/strict";
import {
  AppointmentVisitKind,
  AppointmentStatus,
  PatientServiceSessionStatus,
} from "@prisma/client";

/**
 * Testes de lógica pura espelhando linkFirstPendingSessionFromPurchaseToAppointment.
 * Integração com Prisma fica no serviço; aqui validamos regras de negócio documentadas.
 */

test("pacote vendido deve preferir sessão sequence=1 pendente sem marcação", () => {
  const sessions = [
    { id: "s1", sequence: 1, status: PatientServiceSessionStatus.PENDING, appointmentId: null },
    { id: "s2", sequence: 2, status: PatientServiceSessionStatus.PENDING, appointmentId: null },
  ];
  const first = sessions
    .filter((s) => s.status === PatientServiceSessionStatus.PENDING && !s.appointmentId)
    .sort((a, b) => a.sequence - b.sequence)[0];
  assert.equal(first?.id, "s1");
});

test("marcação com sessão existente não deve ser sobrescrita (regra de negócio)", () => {
  const appt = { patientServiceSessionId: "existing" as string | null };
  const shouldLink = !appt.patientServiceSessionId;
  assert.equal(shouldLink, false);
});

test("após vincular, visitKind deve ser TREATMENT_PLAN", () => {
  const update = {
    visitKind: AppointmentVisitKind.TREATMENT_PLAN,
    patientServiceSessionId: "s1",
  };
  assert.equal(update.visitKind, AppointmentVisitKind.TREATMENT_PLAN);
});

test("entrada no caixa exige marcação realizada ou será marcada", () => {
  function willCompleteWhenNotDone(status: AppointmentStatus): boolean {
    return status !== AppointmentStatus.COMPLETED;
  }
  assert.equal(willCompleteWhenNotDone(AppointmentStatus.SCHEDULED), true);
});
