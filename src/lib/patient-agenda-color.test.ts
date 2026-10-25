import test from "node:test";
import assert from "node:assert/strict";
import {
  isPatientAgendaColor,
  normalizePatientAgendaColorInput,
  patientAgendaColorIndexFromId,
  resolvePatientAgendaColor,
} from "./patient-agenda-color";

test("resolvePatientAgendaColor usa paleta automática estável", () => {
  const a = resolvePatientAgendaColor("patient-abc", null);
  const b = resolvePatientAgendaColor("patient-abc", null);
  assert.equal(a, b);
  assert.equal(isPatientAgendaColor(a), true);
});

test("resolvePatientAgendaColor respeita cor salva válida", () => {
  assert.equal(resolvePatientAgendaColor("x", "#ec4899"), "#ec4899");
});

test("normalizePatientAgendaColorInput rejeita hex fora da paleta", () => {
  assert.equal(normalizePatientAgendaColorInput("#000000"), null);
});

test("patientAgendaColorIndexFromId é determinístico", () => {
  assert.equal(
    patientAgendaColorIndexFromId("023e4173"),
    patientAgendaColorIndexFromId("023e4173"),
  );
});
