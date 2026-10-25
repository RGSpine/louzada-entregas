import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { occurredAtInPeriod, resolveFinancePeriod } from "./period";

describe("gasto variável — duração de um mês civil", () => {
  it("24/09 entra em setembro e some em outubro", () => {
    const tz = "America/Sao_Paulo";
    const occurredAt = DateTime.fromISO("2026-09-24T12:00:00", { zone: tz }).toUTC().toJSDate();
    const setembro = resolveFinancePeriod({
      preset: "MONTH",
      anchorIso: "2026-09-24",
      timezone: tz,
    });
    const outubro = resolveFinancePeriod({
      preset: "MONTH",
      anchorIso: "2026-10-01",
      timezone: tz,
    });

    assert.equal(setembro.periodKey, "2026-09");
    assert.equal(outubro.periodKey, "2026-10");
    assert.equal(occurredAtInPeriod(occurredAt, setembro), true);
    assert.equal(occurredAtInPeriod(occurredAt, outubro), false);
  });
});
