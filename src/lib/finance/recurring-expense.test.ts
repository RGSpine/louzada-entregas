import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { RecurringExpenseFrequency } from "@prisma/client";
import { enumerateOccurrences, recurringPeriodKeyAt } from "./recurring-expense";

describe("enumerateOccurrences", () => {
  it("inclui o mês corrente mesmo se o gasto foi cadastrado após o dia de vencimento", () => {
    const tz = "America/Sao_Paulo";
    // Cadastro em 17/09/2026; vencimento dia 5; período = setembro 2026
    const startedAt = DateTime.fromISO("2026-09-17T15:00:00", { zone: tz }).toUTC().toJSDate();
    const startUtc = DateTime.fromISO("2026-09-01T00:00:00", { zone: tz }).toUTC().toJSDate();
    const endUtc = DateTime.fromISO("2026-10-01T00:00:00", { zone: tz }).toUTC().toJSDate();

    const occ = enumerateOccurrences(
      {
        frequency: RecurringExpenseFrequency.MONTHLY,
        anchorDay: 5,
        startedAt,
        endedAt: null,
      },
      startUtc,
      endUtc,
      tz,
    );

    assert.equal(occ.length, 1);
    assert.equal(occ[0]!.periodKey, "rec-M:2026-09");
  });

  it("não inclui mês anterior ao cadastro", () => {
    const tz = "America/Sao_Paulo";
    const startedAt = DateTime.fromISO("2026-09-17T15:00:00", { zone: tz }).toUTC().toJSDate();
    const startUtc = DateTime.fromISO("2026-08-01T00:00:00", { zone: tz }).toUTC().toJSDate();
    const endUtc = DateTime.fromISO("2026-09-01T00:00:00", { zone: tz }).toUTC().toJSDate();

    const occ = enumerateOccurrences(
      {
        frequency: RecurringExpenseFrequency.MONTHLY,
        anchorDay: 5,
        startedAt,
        endedAt: null,
      },
      startUtc,
      endUtc,
      tz,
    );

    assert.equal(occ.length, 0);
  });
});

describe("recurringPeriodKeyAt", () => {
  it("gera chave mensal estável no fuso do consultório", () => {
    const at = DateTime.fromISO("2026-09-23T18:00:00", { zone: "America/Sao_Paulo" })
      .toUTC()
      .toJSDate();
    assert.equal(recurringPeriodKeyAt(RecurringExpenseFrequency.MONTHLY, at), "rec-M:2026-09");
  });

  it("corta períodos futuros com comparação lexicográfica (gte)", () => {
    const current = "rec-M:2026-09";
    assert.ok("rec-M:2026-09" >= current);
    assert.ok("rec-M:2026-10" >= current);
    assert.ok(!("rec-M:2026-08" >= current));
    assert.ok("rec-W:2026-W39" >= "rec-W:2026-W38");
    assert.ok(!("rec-W:2026-W09" >= "rec-W:2026-W10"));
  });
});
