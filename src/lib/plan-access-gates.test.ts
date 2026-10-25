import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMaxConcurrentSessionsForPlan } from "./access-session";
import {
  canImportPatientHistory,
  canUseAgendaFinanceProjection,
  canUseAgendaIntake,
  canUseFinanceAssistant,
  canUseOfficeFinance,
  canUsePatientClinicalChat,
  canUsePatientExamFolder,
  canUseYieldManagement,
  getMaxHistoryImportsPerMonth,
  isProfissionalOrAbove,
} from "./plan-limits";

describe("gates Premium+ (Consultório financeiro, Ester, pasta exames)", () => {
  it("Básico e Profissional negados", () => {
    for (const plan of ["BASICO", "PROFISSIONAL", "PENDING"] as const) {
      assert.equal(canUseOfficeFinance(plan), false, plan);
      assert.equal(canUseFinanceAssistant(plan), false, plan);
      assert.equal(canUsePatientClinicalChat(plan), false, plan);
      assert.equal(canUsePatientExamFolder(plan), false, plan);
      assert.equal(canUseYieldManagement(plan), false, plan);
    }
  });

  it("Premium, Consultório e Clínica liberados", () => {
    for (const plan of ["PREMIUM", "CONSULTORIO", "CLINICA"] as const) {
      assert.equal(canUseOfficeFinance(plan), true, plan);
      assert.equal(canUsePatientClinicalChat(plan), true, plan);
      assert.equal(canUseYieldManagement(plan), true, plan);
    }
  });
});

describe("gates Profissional+ (agenda, metas, stats avançadas)", () => {
  it("Básico negado; Profissional liberado", () => {
    assert.equal(isProfissionalOrAbove("BASICO"), false);
    assert.equal(isProfissionalOrAbove("PROFISSIONAL"), true);
    assert.equal(canUseAgendaIntake("BASICO"), false);
    assert.equal(canUseAgendaIntake("PROFISSIONAL"), true);
    assert.equal(canUseAgendaFinanceProjection("PROFISSIONAL"), true);
    assert.equal(canUseAgendaFinanceProjection("BASICO"), false);
  });

  it("projeção na agenda ≠ módulo financeiro completo", () => {
    assert.equal(canUseAgendaFinanceProjection("PROFISSIONAL"), true);
    assert.equal(canUseOfficeFinance("PROFISSIONAL"), false);
  });
});

describe("sessões simultâneas por plano", () => {
  it("Premium/Básico/Profissional = 1; Consultório = 5; Clínica = 10", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("BASICO"), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("PROFISSIONAL"), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("PREMIUM"), 1);
    assert.equal(getMaxConcurrentSessionsForPlan("CONSULTORIO"), 5);
    assert.equal(getMaxConcurrentSessionsForPlan("CLINICA"), 10);
  });

  it("PENDING não aplica teto (fluxo checkout)", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("PENDING"), Number.POSITIVE_INFINITY);
  });

  it("influencer individual também é 1 aparelho", () => {
    assert.equal(getMaxConcurrentSessionsForPlan("PREMIUM", null, true), 1);
  });
});

describe("cotas de importação de histórico (distintas das evoluções)", () => {
  it("Básico 5, Profissional 20, Premium+ ilimitado", () => {
    assert.equal(getMaxHistoryImportsPerMonth("BASICO"), 5);
    assert.equal(getMaxHistoryImportsPerMonth("PROFISSIONAL"), 20);
    assert.equal(getMaxHistoryImportsPerMonth("PREMIUM"), Infinity);
    assert.equal(getMaxHistoryImportsPerMonth("CONSULTORIO"), Infinity);
    assert.equal(getMaxHistoryImportsPerMonth("CLINICA"), Infinity);
  });

  it("canImportPatientHistory respeita contagem mensal", () => {
    assert.equal(canImportPatientHistory("BASICO", 4), true);
    assert.equal(canImportPatientHistory("BASICO", 5), false);
    assert.equal(canImportPatientHistory("PROFISSIONAL", 19), true);
    assert.equal(canImportPatientHistory("PROFISSIONAL", 20), false);
    assert.equal(canImportPatientHistory("PREMIUM", 999), true);
  });
});
