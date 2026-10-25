import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAudioLimitLabel,
  formatAudioLimitPhrase,
  getPlanLimits,
  maxAudioSecondsFromLimit,
  canUseAgendaIntake,
  canUseAgendaReports,
  canUseAgendaConfirmationColors,
  canUseAgendaFinanceProjection,
} from "./plan-limits";

describe("limites STARTER atualizados", () => {
  it("STARTER: 80 evoluções, 100 pacientes, 3 min de áudio", () => {
    const starter = getPlanLimits("PROFISSIONAL");
    assert.equal(starter.maxEvolutions, 80);
    assert.equal(starter.maxPatients, 100);
    assert.equal(starter.maxAudioMinutes, 3);
    assert.equal(maxAudioSecondsFromLimit(starter.maxAudioMinutes), 180);
  });
});

describe("limites FREE atualizados", () => {
  it("BASICO: 20 evoluções, 10 pacientes, 2 min de áudio", () => {
    const basico = getPlanLimits("BASICO");
    assert.equal(basico.maxEvolutions, 20);
    assert.equal(basico.maxPatients, 10);
    assert.equal(basico.maxAudioMinutes, 2);
    assert.equal(maxAudioSecondsFromLimit(basico.maxAudioMinutes), 120);
  });

  it("formata áudio de 2 minutos", () => {
    assert.equal(formatAudioLimitLabel(2), "2 min");
    assert.equal(formatAudioLimitPhrase(2), "2 minutos");
  });
});

describe("agenda — gates por plano", () => {
  it("FREE não usa agendamento por áudio nem relatórios", () => {
    assert.equal(canUseAgendaIntake("BASICO"), false);
    assert.equal(canUseAgendaReports("BASICO"), false);
  });

  it("STARTER usa agendamento por áudio, não relatórios", () => {
    assert.equal(canUseAgendaIntake("PROFISSIONAL"), true);
    assert.equal(canUseAgendaReports("PROFISSIONAL"), false);
    assert.equal(canUseAgendaConfirmationColors("PROFISSIONAL"), true);
    assert.equal(canUseAgendaFinanceProjection("PROFISSIONAL"), true);
  });

  it("PRO usa agendamento e relatórios", () => {
    assert.equal(canUseAgendaIntake("PREMIUM"), true);
    assert.equal(canUseAgendaReports("PREMIUM"), true);
    assert.equal(canUseAgendaConfirmationColors("PREMIUM"), true);
    assert.equal(canUseAgendaFinanceProjection("PREMIUM"), true);
  });

  it("FREE não usa cores de confirmação na agenda", () => {
    assert.equal(canUseAgendaConfirmationColors("BASICO"), false);
    assert.equal(canUseAgendaFinanceProjection("BASICO"), false);
  });
});
