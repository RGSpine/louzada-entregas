import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ageInCompletedYears,
  ageLabelFromBirthAndAttendance,
  formatAgeYearsLabel,
  parseDateOfBirthIso,
  resolveBirthAndAgeForPersist,
  resolvePatientAgeLabel,
} from "./patient-age";

describe("patient-age", () => {
  it("parseDateOfBirthIso rejeita data futura e inválida", () => {
    assert.equal(parseDateOfBirthIso("1988-03-15")?.getUTCDate(), 15);
    assert.equal(parseDateOfBirthIso("15/03/1988"), null);
    assert.equal(parseDateOfBirthIso("2026-02-31"), null);
    assert.equal(parseDateOfBirthIso("2999-01-01"), null);
  });

  it("ageInCompletedYears conta aniversário ainda não ocorrido no ano", () => {
    const birth = parseDateOfBirthIso("1990-10-01")!;
    const before = new Date(Date.UTC(2026, 8, 1, 12, 0, 0, 0));
    const after = new Date(Date.UTC(2026, 9, 1, 12, 0, 0, 0));
    assert.equal(ageInCompletedYears(birth, before), 35);
    assert.equal(ageInCompletedYears(birth, after), 36);
  });

  it("resolvePatientAgeLabel prefere nascimento e formata anos", () => {
    const at = new Date(Date.UTC(2026, 8, 28, 12, 0, 0, 0));
    assert.equal(
      resolvePatientAgeLabel({ dateOfBirth: "2000-09-28", fallbackAge: "99", at }),
      "26 anos",
    );
    assert.equal(
      resolvePatientAgeLabel({ dateOfBirth: null, fallbackAge: "42 anos" }),
      "42 anos",
    );
    assert.equal(formatAgeYearsLabel(1), "1 ano");
  });

  it("idade na evolução usa a data de atendimento, não o dia de hoje", () => {
    assert.equal(
      ageLabelFromBirthAndAttendance("2010-03-01", "01/03/2018"),
      "8 anos",
    );
    assert.equal(
      ageLabelFromBirthAndAttendance("2010-03-01", "2018-03-01"),
      "8 anos",
    );
  });

  it("resolveBirthAndAgeForPersist atualiza idade corrente e permite limpar nascimento", () => {
    const kept = resolveBirthAndAgeForPersist({
      existingBirth: parseDateOfBirthIso("1990-01-01"),
      existingAge: "stale",
    });
    assert.ok(kept.dateOfBirth);
    assert.match(kept.age ?? "", /anos$/);

    const cleared = resolveBirthAndAgeForPersist({
      incomingBirthIso: "",
      existingBirth: parseDateOfBirthIso("1990-01-01"),
      incomingAge: "40 anos",
    });
    assert.equal(cleared.dateOfBirth, null);
    assert.equal(cleared.age, "40 anos");
  });
});
