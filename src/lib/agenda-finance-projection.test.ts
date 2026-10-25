import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  AppointmentConfirmationStatus,
  AppointmentStatus,
  AppointmentVisitKind,
} from "@prisma/client";
import { buildAgendaFinanceProjection } from "./agenda-finance-projection";

const TZ = "America/Sao_Paulo";
const WEEK_START = DateTime.fromObject({ year: 2026, month: 7, day: 6 }, { zone: TZ }); // segunda

test("buildAgendaFinanceProjection separa consultas avulsas de plano", () => {
  const mondayMorning = DateTime.fromObject(
    { year: 2026, month: 7, day: 6, hour: 10 },
    { zone: TZ },
  )
    .toUTC()
    .toJSDate();

  const projection = buildAgendaFinanceProjection(
    [
      {
        startAt: mondayMorning,
        status: AppointmentStatus.SCHEDULED,
        visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
        priceCents: 20000,
        confirmationStatus: AppointmentConfirmationStatus.PENDING_CONFIRMATION,
      },
      {
        startAt: mondayMorning,
        status: AppointmentStatus.SCHEDULED,
        visitKind: AppointmentVisitKind.TREATMENT_PLAN,
        priceCents: 15000,
      },
      {
        startAt: mondayMorning,
        status: AppointmentStatus.COMPLETED,
        visitKind: AppointmentVisitKind.RETURN,
        priceCents: 10000,
      },
    ],
    WEEK_START,
    TZ,
  );

  assert.equal(projection.scheduledCashCents, 20000);
  assert.equal(projection.scheduledCashCount, 1);
  assert.equal(projection.completedCashCents, 10000);
  assert.equal(projection.planScheduledCount, 1);
  assert.equal(projection.planScheduledValueCents, 15000);
  assert.equal(projection.weekTotalCashCents, 30000);
  assert.equal(projection.pendingConfirmationCount, 1);
  assert.equal(projection.byDay[0]!.scheduledCashCents, 20000);
});

test("buildAgendaFinanceProjection ignora canceladas", () => {
  const projection = buildAgendaFinanceProjection(
    [
      {
        startAt: WEEK_START.toUTC().toJSDate(),
        status: AppointmentStatus.CANCELLED,
        visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
        priceCents: 50000,
      },
    ],
    WEEK_START,
    TZ,
  );

  assert.equal(projection.scheduledCashCents, 0);
  assert.equal(projection.weekTotalCashCents, 0);
});

test("buildAgendaFinanceProjection ignora faltas", () => {
  const projection = buildAgendaFinanceProjection(
    [
      {
        startAt: WEEK_START.toUTC().toJSDate(),
        status: AppointmentStatus.NO_SHOW,
        visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
        priceCents: 50000,
      },
    ],
    WEEK_START,
    TZ,
  );

  assert.equal(projection.scheduledCashCents, 0);
  assert.equal(projection.weekTotalCashCents, 0);
});
