import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  buildTreatmentPlanBatchSlots,
  findInternalBatchSlotOverlap,
  mapPurchaseToBatchCandidate,
} from "./appointment-treatment-plan-batch";
import { PatientServiceSessionStatus } from "@prisma/client";

test("buildTreatmentPlanBatchSlots gera intervalo semanal", () => {
  const tz = "America/Sao_Paulo";
  const first = DateTime.fromObject(
    { year: 2026, month: 7, day: 1, hour: 9, minute: 0 },
    { zone: tz },
  )
    .toUTC()
    .toJSDate();

  const slots = buildTreatmentPlanBatchSlots({
    sessions: [
      { id: "s1", sequence: 1, allocatedPriceCents: 10000 },
      { id: "s2", sequence: 2, allocatedPriceCents: 10000 },
    ],
    firstStartAt: first,
    durationMinutes: 60,
    intervalDays: 7,
    timezone: tz,
  });

  assert.equal(slots.length, 2);
  assert.equal(slots[0]!.sessionId, "s1");
  assert.equal(slots[1]!.sequence, 2);
  const secondLocal = DateTime.fromJSDate(slots[1]!.startAt, { zone: "utc" }).setZone(tz);
  assert.equal(secondLocal.day, 8);
});

test("findInternalBatchSlotOverlap detecta sobreposição no lote", () => {
  const start = new Date("2026-07-01T12:00:00.000Z");
  const end = new Date("2026-07-01T13:00:00.000Z");
  const msg = findInternalBatchSlotOverlap([
    { startAt: start, endAt: end, label: "A" },
    { startAt: new Date("2026-07-01T12:30:00.000Z"), endAt: new Date("2026-07-01T13:30:00.000Z"), label: "B" },
  ]);
  assert.ok(msg);
});

test("mapPurchaseToBatchCandidate ignora sessões já agendadas ou consumidas", () => {
  const candidate = mapPurchaseToBatchCandidate({
    id: "p1",
    patientId: "pat1",
    agreedPriceCents: 30000,
    sessionCountTotal: 3,
    purchasedAt: new Date(),
    patient: { name: "Ana" },
    service: { name: "Fisioterapia" },
    sessions: [
      {
        id: "s1",
        sequence: 1,
        status: PatientServiceSessionStatus.CONSUMED,
        allocatedPriceCents: 10000,
        appointment: null,
      },
      {
        id: "s2",
        sequence: 2,
        status: PatientServiceSessionStatus.PENDING,
        allocatedPriceCents: 10000,
        appointment: { id: "apt1" },
      },
      {
        id: "s3",
        sequence: 3,
        status: PatientServiceSessionStatus.PENDING,
        allocatedPriceCents: 10000,
        appointment: null,
      },
    ],
  });

  assert.ok(candidate);
  assert.equal(candidate!.schedulableCount, 1);
  assert.equal(candidate!.sessions[0]!.id, "s3");
});
