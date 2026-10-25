import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  buildIdleSlotWindows,
  centsToReais,
  rangesOverlap,
  timeLabelToMinutes,
} from "@/lib/marketplace/slot-grid";

describe("slot-grid", () => {
  it("gera grade 8–18 em America/Sao_Paulo e pula domingo", () => {
    const from = new Date("2026-09-23T12:00:00.000Z");
    const windows = buildIdleSlotWindows(from, 7);
    assert.ok(windows.length > 0);

    const firstLocal = DateTime.fromJSDate(windows[0]!.startUtc, { zone: "utc" })
      .setZone("America/Sao_Paulo");
    assert.equal(firstLocal.hour, 10);
    assert.equal(firstLocal.weekday, 3);

    const hasSunday = windows.some((window) => {
      const local = DateTime.fromJSDate(window.startUtc, { zone: "utc" }).setZone(
        "America/Sao_Paulo",
      );
      return local.weekday === 7;
    });
    assert.equal(hasSunday, false);
  });

  it("respeita janela semanal custom (só terça 14h–16h)", () => {
    const from = new Date("2026-09-21T12:00:00.000Z"); // segunda
    const windows = buildIdleSlotWindows(from, 7, "America/Sao_Paulo", [
      {
        recurrence: "WEEKLY",
        weekdays: [2],
        startMinute: 14 * 60,
        endMinute: 16 * 60,
      },
    ]);
    assert.ok(windows.length >= 2);
    for (const window of windows) {
      const local = DateTime.fromJSDate(window.startUtc, { zone: "utc" }).setZone(
        "America/Sao_Paulo",
      );
      assert.equal(local.weekday, 2);
      assert.ok(local.hour >= 14 && local.hour < 16);
    }
  });

  it("respeita janela pontual (ONCE)", () => {
    const from = new Date("2026-09-20T12:00:00.000Z");
    const windows = buildIdleSlotWindows(from, 10, "America/Sao_Paulo", [
      {
        recurrence: "ONCE",
        weekdays: [],
        startMinute: 9 * 60,
        endMinute: 11 * 60,
        specificDate: "2026-09-25",
      },
    ]);
    assert.equal(windows.length, 2);
    const first = DateTime.fromJSDate(windows[0]!.startUtc, { zone: "utc" }).setZone(
      "America/Sao_Paulo",
    );
    assert.equal(first.toFormat("yyyy-LL-dd"), "2026-09-25");
    assert.equal(first.hour, 9);
  });

  it("converte centavos, HH:mm e detecta sobreposição", () => {
    assert.equal(centsToReais(15000), 150);
    assert.equal(centsToReais(null), 150);
    assert.equal(timeLabelToMinutes("08:30"), 510);
    const aStart = new Date("2026-09-26T11:00:00.000Z");
    const aEnd = new Date("2026-09-26T12:00:00.000Z");
    const bStart = new Date("2026-09-26T11:30:00.000Z");
    const bEnd = new Date("2026-09-26T12:30:00.000Z");
    assert.equal(rangesOverlap(aStart, aEnd, bStart, bEnd), true);
    assert.equal(
      rangesOverlap(
        aStart,
        aEnd,
        new Date("2026-09-26T12:00:00.000Z"),
        new Date("2026-09-26T13:00:00.000Z"),
      ),
      false,
    );
  });
});
