import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agendaGhostClinicalPatientWhere } from "@/lib/agenda-ghost-clinical-cleanup";

describe("agendaGhostClinicalPatientWhere", () => {
  it("exige marcação e ficha clínica vazia (não demove cadastro tradicional sem agenda)", () => {
    assert.equal(agendaGhostClinicalPatientWhere.agendaOnly, false);
    assert.deepEqual(agendaGhostClinicalPatientWhere.evolutions, { none: {} });
    assert.deepEqual(agendaGhostClinicalPatientWhere.appointments, { some: {} });
    assert.equal(agendaGhostClinicalPatientWhere.age, null);
    assert.equal(agendaGhostClinicalPatientWhere.diagnosis, null);
    assert.equal(agendaGhostClinicalPatientWhere.history, null);
    assert.equal(agendaGhostClinicalPatientWhere.clinicalSummary, null);
  });
});
