import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTeamAttendanceOutcome,
  type TeamEvolutionAttendanceRow,
} from "./team-evolution-attendance";

const base: TeamEvolutionAttendanceRow = {
  evolutionId: "evo_1",
  attendanceDateIso: "2026-09-23T15:00:00.000Z",
  patientId: "p1",
  patientName: "Ana",
  professionalName: "João",
  professionalColor: "#2563EB",
  professionalRole: "MEMBER",
  sessionConsumed: true,
  sessionLabel: "Sessão 5 de 8 · RPG",
  saleClosed: false,
  saleLabel: null,
  salePaid: null,
};

describe("formatTeamAttendanceOutcome", () => {
  it("baixa de sessão sem venda nova", () => {
    const text = formatTeamAttendanceOutcome(base);
    assert.match(text, /Sessão 5 de 8/);
    assert.match(text, /Não fechou serviço/);
  });

  it("venda nova pendente no caixa", () => {
    const text = formatTeamAttendanceOutcome({
      ...base,
      sessionConsumed: true,
      saleClosed: true,
      saleLabel: "RPG (plano de 8 sessões)",
      salePaid: false,
    });
    assert.match(text, /Fechou RPG/);
    assert.match(text, /pagamento pendente/);
  });
});
