import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePatientNameFromGoogleSummary,
  GOOGLE_IMPORT_FALLBACK_PATIENT_NAME,
} from "./google-calendar-import";
import {
  appointmentPatientDisplayName,
  appointmentDisplayNameMatchesPatient,
  cardNameForSimilarPatientSearch,
  appointmentRequiresPatientLinkChoice,
  isConsultaGoogleSummary,
} from "./patient-clinical-scope";
import { AppointmentSource } from "@prisma/client";

test("parsePatientNameFromGoogleSummary extrai nome após Consulta —", () => {
  assert.equal(parsePatientNameFromGoogleSummary("Consulta — Maria Silva"), "Maria Silva");
  assert.equal(parsePatientNameFromGoogleSummary("consulta - João"), "João");
});

test("parsePatientNameFromGoogleSummary usa summary genérico", () => {
  assert.equal(parsePatientNameFromGoogleSummary("Reunião equipe"), "Reunião equipe");
});

test("parsePatientNameFromGoogleSummary retorna null para vazio", () => {
  assert.equal(parsePatientNameFromGoogleSummary(""), null);
  assert.equal(parsePatientNameFromGoogleSummary("  "), null);
});

test("isConsultaGoogleSummary só aceita padrão Consulta —", () => {
  assert.equal(isConsultaGoogleSummary("Consulta — Maria"), true);
  assert.equal(isConsultaGoogleSummary("Gustavo - Quiropraxia"), false);
  assert.equal(isConsultaGoogleSummary("Almoço"), false);
});

test("appointmentPatientDisplayName prioriza título em GOOGLE_SYNC", () => {
  assert.equal(
    appointmentPatientDisplayName({
      source: AppointmentSource.GOOGLE_SYNC,
      title: "Almoço",
      patientName: GOOGLE_IMPORT_FALLBACK_PATIENT_NAME,
    }),
    "Almoço",
  );
});

test("appointmentPatientDisplayName mantém paciente em marcação manual", () => {
  assert.equal(
    appointmentPatientDisplayName({
      source: AppointmentSource.MANUAL,
      title: null,
      patientName: "Maria",
    }),
    "Maria",
  );
});

test("appointmentPatientDisplayName não duplica nome quando title = paciente", () => {
  assert.equal(
    appointmentPatientDisplayName({
      source: AppointmentSource.MANUAL,
      title: "Eric",
      patientName: "Eric",
    }),
    "Eric",
  );
});

test("appointmentDisplayNameMatchesPatient ignora sufixo de título", () => {
  assert.equal(appointmentDisplayNameMatchesPatient("Bruna — retorno", "Bruna"), true);
  assert.equal(appointmentDisplayNameMatchesPatient("Eduardo", "Bruna"), false);
  assert.equal(cardNameForSimilarPatientSearch("Eduardo", "Bruna"), "Eduardo");
  assert.equal(
    appointmentRequiresPatientLinkChoice({
      isAgendaPlaceholderPatient: false,
      displayPatientName: "Eduardo",
      registeredPatientName: "Bruna",
    }),
    true,
  );
  assert.equal(
    appointmentRequiresPatientLinkChoice({
      isAgendaPlaceholderPatient: false,
      displayPatientName: "Bruna",
      registeredPatientName: "Bruna",
    }),
    false,
  );
});
