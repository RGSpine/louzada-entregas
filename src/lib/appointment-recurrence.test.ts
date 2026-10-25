import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { buildRecurrenceSlots } from "./appointment-recurrence";

const TZ = "America/Sao_Paulo";

function utcFromLocal(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return DateTime.fromObject({ year, month, day, hour, minute }, { zone: TZ }).toUTC().toJSDate();
}

test("buildRecurrenceSlots gera 10 sessões em seg/qua/sex a partir de uma segunda", () => {
  const first = utcFromLocal(2026, 9, 28, 9, 0); // segunda
  const slots = buildRecurrenceSlots({
    firstStartAt: first,
    durationMinutes: 45,
    sessionCount: 10,
    weekdays: [1, 3, 5],
    timezone: TZ,
  });

  assert.equal(slots.length, 10);
  const localDays = slots.map((s) => DateTime.fromJSDate(s.startAt, { zone: "utc" }).setZone(TZ));
  assert.equal(localDays[0]!.weekday, 1);
  assert.equal(localDays[1]!.weekday, 3);
  assert.equal(localDays[2]!.weekday, 5);
  assert.equal(localDays[3]!.weekday, 1);
  assert.equal(localDays[0]!.toFormat("HH:mm"), "09:00");
  const duration = localDays[0]!.plus({ minutes: 45 }).diff(localDays[0]!, "minutes").minutes;
  assert.equal(duration, 45);
  const last = localDays[9]!;
  assert.equal(last.toFormat("yyyy-LL-dd"), "2026-10-19");
});

test("buildRecurrenceSlots mantém a âncora mesmo fora dos dias escolhidos", () => {
  const tuesday = utcFromLocal(2026, 9, 29, 14, 30);
  const slots = buildRecurrenceSlots({
    firstStartAt: tuesday,
    durationMinutes: 30,
    sessionCount: 4,
    weekdays: [1, 3, 5],
    timezone: TZ,
  });

  const local = slots.map((s) => DateTime.fromJSDate(s.startAt, { zone: "utc" }).setZone(TZ));
  assert.equal(local[0]!.weekday, 2);
  assert.equal(local[1]!.weekday, 3);
  assert.equal(local[2]!.weekday, 5);
  assert.equal(local[3]!.weekday, 1);
  assert.equal(local[0]!.toFormat("HH:mm"), "14:30");
});

test("buildRecurrenceSlots rejeita weekdays vazios", () => {
  const first = utcFromLocal(2026, 9, 28, 10, 0);
  assert.throws(
    () =>
      buildRecurrenceSlots({
        firstStartAt: first,
        durationMinutes: 60,
        sessionCount: 4,
        weekdays: [],
        timezone: TZ,
      }),
    /dia da semana/i,
  );
});
