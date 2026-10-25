import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentVisitKind } from "@prisma/client";
import {
  buildAppointmentIncomeDescription,
  isCashAppointmentVisitKind,
} from "./appointment-income";
test("isCashAppointmentVisitKind inclui consulta e retorno", () => {
  assert.equal(isCashAppointmentVisitKind(AppointmentVisitKind.UNIQUE_CONSULTATION), true);
  assert.equal(isCashAppointmentVisitKind(AppointmentVisitKind.RETURN), true);
  assert.equal(isCashAppointmentVisitKind(AppointmentVisitKind.TREATMENT_PLAN), false);
});

test("buildAppointmentIncomeDescription formata tipo e paciente", () => {
  const desc = buildAppointmentIncomeDescription({
    visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
    patientDisplayName: "André",
  });
  assert.match(desc, /Serviço avulso/);
  assert.match(desc, /André/);
});
