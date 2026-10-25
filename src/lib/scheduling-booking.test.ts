import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { resolveTimeOnDay } from "./scheduling-booking";

const day = DateTime.fromISO("2026-05-22T12:00:00", { zone: "America/Sao_Paulo" }).startOf("day");

test("resolveTimeOnDay: 16h", () => {
  const r = resolveTimeOnDay(day, "16h");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.at.hour, 16);
});

test("resolveTimeOnDay: às 16", () => {
  const r = resolveTimeOnDay(day, "às 16");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.at.hour, 16);
});

test("resolveTimeOnDay: 16:30", () => {
  const r = resolveTimeOnDay(day, "16:30");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.at.hour, 16);
    assert.equal(r.at.minute, 30);
  }
});

test("resolveTimeOnDay: vazio falha (sem fallback 09:00)", () => {
  const r = resolveTimeOnDay(day, null);
  assert.equal(r.ok, false);
});

test("resolveTimeOnDay: lixo não vira 09:00", () => {
  const r = resolveTimeOnDay(day, "de manhã cedo");
  assert.equal(r.ok, false);
});
