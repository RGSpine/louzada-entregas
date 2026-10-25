import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatEvolutionFinanceFollowUp,
  formatEvolutionSessionConsumptionMessage,
  formatPackageNearEndWarning,
  isPackageApproachingEnd,
  type EvolutionSessionConsumptionSummary,
} from "./evolution-session-consumption";

const paid: EvolutionSessionConsumptionSummary = {
  consumed: true,
  serviceName: "RPG",
  sequence: 5,
  sessionCount: 8,
  pendingRemaining: 3,
  consumedAtIso: "2026-09-23T15:00:00.000Z",
  hasIncomePayment: true,
};

describe("formatEvolutionSessionConsumptionMessage", () => {
  it("descreve a N-ésima sessão do plano na data da evolução", () => {
    const text = formatEvolutionSessionConsumptionMessage(paid);
    assert.ok(text);
    assert.match(text, /Sessão 5 de 8/);
    assert.match(text, /RPG/);
    assert.match(text, /Restam 3 pendente/);
  });

  it("destaca proximidade do fim com 2 sessões restantes", () => {
    const text = formatEvolutionSessionConsumptionMessage({
      ...paid,
      sequence: 6,
      pendingRemaining: 2,
    });
    assert.ok(text);
    assert.match(text!, /faltam só 2 sessões/i);
  });

  it("não formata quando não houve baixa", () => {
    assert.equal(
      formatEvolutionSessionConsumptionMessage({ consumed: false, reason: "sem plano" }),
      null,
    );
  });
});

describe("isPackageApproachingEnd / formatPackageNearEndWarning", () => {
  it("avisa em 2 e 1 restantes após ao menos uma sessão feita", () => {
    assert.equal(isPackageApproachingEnd({ pendingRemaining: 2, sessionCount: 8 }), true);
    assert.equal(isPackageApproachingEnd({ pendingRemaining: 1, sessionCount: 8 }), true);
    assert.match(
      formatPackageNearEndWarning({
        pendingRemaining: 2,
        sessionCount: 8,
        serviceName: "RPG",
        patientName: "Ana",
      }) ?? "",
      /Ana.*2 sessões/i,
    );
    assert.match(
      formatPackageNearEndWarning({
        pendingRemaining: 1,
        sessionCount: 8,
        serviceName: "RPG",
      }) ?? "",
      /última sessão/i,
    );
  });

  it("não avisa no início do pacote nem com saldo alto", () => {
    assert.equal(isPackageApproachingEnd({ pendingRemaining: 2, sessionCount: 2 }), false);
    assert.equal(isPackageApproachingEnd({ pendingRemaining: 3, sessionCount: 8 }), false);
    assert.equal(isPackageApproachingEnd({ pendingRemaining: 0, sessionCount: 8 }), false);
    assert.equal(formatPackageNearEndWarning({ pendingRemaining: 5, sessionCount: 8 }), null);
  });
});

describe("formatEvolutionFinanceFollowUp", () => {
  it("informa caixa já pago vs pendente", () => {
    assert.match(formatEvolutionFinanceFollowUp(paid) ?? "", /já pago/);
    assert.match(
      formatEvolutionFinanceFollowUp({ ...paid, hasIncomePayment: false }) ?? "",
      /pendente/,
    );
  });
});
