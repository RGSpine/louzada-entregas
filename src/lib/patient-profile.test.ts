import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyToNull,
  formatEvolutionAttendanceDatePtBr,
  updatePatientProfileSchema,
} from "./patient-profile";

describe("patient-profile", () => {
  it("exige nome com pelo menos 2 caracteres", () => {
    const bad = updatePatientProfileSchema.safeParse({
      patientId: "00000000-0000-4000-8000-000000000001",
      name: "A",
    });
    assert.equal(bad.success, false);

    const good = updatePatientProfileSchema.safeParse({
      patientId: "00000000-0000-4000-8000-000000000001",
      name: "Rodolfo",
      age: "24 anos",
      diagnosis: "Dor miofascial",
      history: "Histórico importado",
    });
    const goodDob = updatePatientProfileSchema.safeParse({
      patientId: "00000000-0000-4000-8000-000000000001",
      name: "Rodolfo",
      dateOfBirth: "1990-03-15",
    });
    assert.equal(goodDob.success, true);

    const badDob = updatePatientProfileSchema.safeParse({
      patientId: "00000000-0000-4000-8000-000000000001",
      name: "Rodolfo",
      dateOfBirth: "15/03/1990",
    });
    assert.equal(badDob.success, false);
  });

  it("emptyToNull trata espaços como ausente", () => {
    assert.equal(emptyToNull("  "), null);
    assert.equal(emptyToNull("42"), "42");
  });

  it("formata data de atendimento no padrão do PDF nativo", () => {
    const label = formatEvolutionAttendanceDatePtBr(new Date(2026, 8, 7, 12, 0, 0));
    assert.match(label, /^\d{2}\/\d{2}\/\d{4}$/);
  });
});
