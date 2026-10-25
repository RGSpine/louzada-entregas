import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bpsToPercentDisplay,
  buildCollaboratorBalanceLine,
  commissionCentsFromBase,
  percentInputToBps,
  resolveCollaboratorPeriod,
} from "./collaborator-balance";

describe("commissionCentsFromBase", () => {
  it("calcula 40% de R$ 100,00", () => {
    assert.equal(commissionCentsFromBase(10_000, 4000), 4000);
  });

  it("arredonda para baixo (floor)", () => {
    assert.equal(commissionCentsFromBase(100, 3333), 33);
  });

  it("zera com bps 0 ou base negativa", () => {
    assert.equal(commissionCentsFromBase(10_000, 0), 0);
    assert.equal(commissionCentsFromBase(-50, 5000), 0);
  });
});

describe("percent ↔ bps", () => {
  it("converte ida e volta", () => {
    assert.equal(percentInputToBps("40"), 4000);
    assert.equal(percentInputToBps("12,5"), 1250);
    assert.equal(bpsToPercentDisplay(4000), "40");
    assert.equal(bpsToPercentDisplay(1250), "12,5");
  });

  it("rejeita fora de 0–100", () => {
    assert.equal(percentInputToBps("101"), null);
    assert.equal(percentInputToBps("-1"), null);
  });
});

describe("resolveCollaboratorPeriod", () => {
  it("mês civil", () => {
    const p = resolveCollaboratorPeriod({
      preset: "MONTH",
      anchorIso: "2026-09-24",
      timezone: "America/Sao_Paulo",
    });
    assert.equal(p.periodKey, "rec-M:2026-09");
    assert.match(p.label, /setembro/i);
  });

  it("1ª e 2ª quinzena", () => {
    const h1 = resolveCollaboratorPeriod({
      preset: "FORTNIGHT",
      anchorIso: "2026-09-10",
      timezone: "America/Sao_Paulo",
    });
    const h2 = resolveCollaboratorPeriod({
      preset: "FORTNIGHT",
      anchorIso: "2026-09-24",
      timezone: "America/Sao_Paulo",
    });
    assert.equal(h1.periodKey, "rec-F:2026-09-H1");
    assert.equal(h2.periodKey, "rec-F:2026-09-H2");
  });

  it("semana ISO", () => {
    const p = resolveCollaboratorPeriod({
      preset: "WEEK",
      anchorIso: "2026-09-24",
      timezone: "America/Sao_Paulo",
    });
    assert.match(p.periodKey, /^rec-W:2026-W/);
  });
});

describe("buildCollaboratorBalanceLine", () => {
  it("saldo = devido − pago (nunca negativo)", () => {
    const line = buildCollaboratorBalanceLine({
      intraUserId: "iu1",
      name: "Ana",
      color: "#2563EB",
      role: "MEMBER",
      commissionRateBps: 5000,
      attendanceCount: 2,
      baseCents: 20_000,
      paidCents: 3_000,
      attendances: [
        {
          consumptionId: "c1",
          patientId: "p1",
          patientName: "João",
          attendanceDateIso: "2026-09-24T15:00:00.000Z",
          sessionValueCents: 10_000,
          serviceName: "Fisio",
        },
      ],
    });
    assert.equal(line.commissionDueCents, 10_000);
    assert.equal(line.balanceCents, 7_000);
    assert.equal(line.attendances.length, 1);

    const overpaid = buildCollaboratorBalanceLine({
      intraUserId: "iu1",
      name: "Ana",
      color: "#2563EB",
      role: "MEMBER",
      commissionRateBps: 5000,
      attendanceCount: 2,
      baseCents: 20_000,
      paidCents: 99_000,
    });
    assert.equal(overpaid.balanceCents, 0);
    assert.equal(overpaid.attendances.length, 0);
    assert.equal(overpaid.payouts.length, 0);
  });
});
