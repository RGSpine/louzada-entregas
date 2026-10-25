import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  expandMultiDayDateExpressions,
  essaWeekdayOccurrence,
  nextCalendarWeekRange,
  normalizePtExpression,
  resolveAppointmentWindow,
  stripTrailingTimeFromDateExpression,
} from "./schedule-temporal-parse";
import { DateTime } from "luxon";

const REF = DateTime.fromObject(
  { year: 2026, month: 4, day: 29, hour: 12, minute: 0 },
  { zone: DEFAULT_SCHEDULE_TIMEZONE }
).toJSDate();

test("normalizePtExpression remove acentos", () => {
  assert.equal(normalizePtExpression("  Amanhã  "), "amanha");
  assert.equal(normalizePtExpression("Próxima segunda-feira"), "proxima segunda feira");
});

test("amanhã = 30 abril 2026 (civil SP)", () => {
  const r = resolveAppointmentWindow("amanhã", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-04-30");
});

test("semana que vem: 4–10 maio 2026 (seg–dom)", () => {
  const r = resolveAppointmentWindow("semana que vem", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  const e = DateTime.fromJSDate(r.endUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.weekday, 1);
  assert.equal(s.toISODate(), "2026-05-04");
  assert.equal(e.weekday, 7);
  assert.equal(e.toISODate(), "2026-05-10");
});

test("próxima segunda após quarta 29/04 = 4 maio", () => {
  const r = resolveAppointmentWindow("próxima segunda", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-04");
});

test("próxima quinta quando hoje é quinta = +7 dias", () => {
  const thu = DateTime.fromObject(
    { year: 2026, month: 5, day: 7, hour: 10, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE }
  ).toJSDate();
  const r = resolveAppointmentWindow("próxima quinta", thu, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-14");
});

test("quinta dia 30 de abril 2026", () => {
  const r = resolveAppointmentWindow(
    "quinta dia 30 de abril",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-04-30");
});

test("quinta dia 29 de abril 2026 é ambíguo (29 é quarta)", () => {
  const r = resolveAppointmentWindow(
    "quinta dia 29 de abril",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "AMBIGUOUS");
});

test("30 de abril sem weekday — ano corrente se ainda futuro", () => {
  const r = resolveAppointmentWindow("30 de abril", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-04-30");
});

test("nextCalendarWeekRange: domingo civil = segunda + 6 dias", () => {
  const nowLux = DateTime.fromJSDate(REF, { zone: DEFAULT_SCHEDULE_TIMEZONE });
  const { start, end } = nextCalendarWeekRange(nowLux);
  const endStart = end.setZone(DEFAULT_SCHEDULE_TIMEZONE).startOf("day");
  assert.equal(endStart.diff(start, "days").days, 6);
});

test("essa terça com hoje domingo → terça iminente (26/05/2026)", () => {
  const sun = DateTime.fromObject(
    { year: 2026, month: 5, day: 24, hour: 10, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const r = resolveAppointmentWindow("essa terça", sun, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-26");
  assert.equal(s.weekday, 2);
});

test("essa quinta com hoje domingo → quinta iminente", () => {
  const sun = DateTime.fromObject(
    { year: 2026, month: 5, day: 24, hour: 10, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const r = resolveAppointmentWindow("essa quinta", sun, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-28");
});

test("essa terça quando hoje é terça → hoje", () => {
  const tue = DateTime.fromObject(
    { year: 2026, month: 5, day: 26, hour: 9, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const r = resolveAppointmentWindow("essa terça", tue, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-26");
});

test("26/05 resolve para 26 de maio", () => {
  const sun = DateTime.fromObject(
    { year: 2026, month: 5, day: 24, hour: 10, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const r = resolveAppointmentWindow("26/05", sun, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-05-26");
});

test("essaWeekdayOccurrence domingo→terça = +2 dias", () => {
  const sun = DateTime.fromObject(
    { year: 2026, month: 5, day: 24 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  );
  const tue = essaWeekdayOccurrence(sun, 2);
  assert.equal(tue.toISODate(), "2026-05-26");
});

test("stripTrailingTimeFromDateExpression remove hora colada", () => {
  assert.equal(
    stripTrailingTimeFromDateExpression("terça e quinta às 19:30"),
    "terca e quinta",
  );
  assert.equal(stripTrailingTimeFromDateExpression("amanhã"), "amanha");
});

test("stripTrailingTimeFromDateExpression cobre hMM (14h30) com às/as", () => {
  assert.equal(
    stripTrailingTimeFromDateExpression("terça e quinta às 14h30"),
    "terca e quinta",
  );
  assert.equal(
    stripTrailingTimeFromDateExpression("terça e quinta as 14h30"),
    "terca e quinta",
  );
  assert.equal(
    stripTrailingTimeFromDateExpression("terça e quinta às 14 h30"),
    "terca e quinta",
  );
  assert.equal(
    stripTrailingTimeFromDateExpression("terça e quinta 14h30"),
    "terca e quinta",
  );
  // Não deve comer "dia 14" sem marcador de hora.
  assert.equal(stripTrailingTimeFromDateExpression("dia 14"), "dia 14");
});

test("expandMultiDayDateExpressions: terça e quinta (mesma semana civil após quarta)", () => {
  // REF = quarta 29/04/2026 → âncora = terça 05/05 → quinta alinhada 07/05 (não 30/04).
  const dates = expandMultiDayDateExpressions("terça e quinta", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.deepEqual(dates, ["05/05/2026", "07/05/2026"]);
});

test("expandMultiDayDateExpressions: terça e quinta às 19:30 (hora colada)", () => {
  const dates = expandMultiDayDateExpressions(
    "terça e quinta às 19:30",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.deepEqual(dates, ["05/05/2026", "07/05/2026"]);
});

test("expandMultiDayDateExpressions: segunda, quarta e sexta", () => {
  const dates = expandMultiDayDateExpressions(
    "segunda, quarta e sexta",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.deepEqual(dates, ["04/05/2026", "06/05/2026", "08/05/2026"]);
});

test("expandMultiDayDateExpressions: terça+quinta a partir de quarta 13/08 → 18 e 20/08", () => {
  const wed = DateTime.fromObject(
    { year: 2026, month: 8, day: 13, hour: 12, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const dates = expandMultiDayDateExpressions("terça e quinta", wed, DEFAULT_SCHEDULE_TIMEZONE);
  assert.deepEqual(dates, ["18/08/2026", "20/08/2026"]);
});

test("expandMultiDayDateExpressions: weekday + datas explícitas com vírgulas", () => {
  const wed = DateTime.fromObject(
    { year: 2026, month: 8, day: 13, hour: 12, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const dates = expandMultiDayDateExpressions(
    "terça feira, 18/08, e quinta feira, 20/08",
    wed,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.deepEqual(dates, ["18/08/2026", "20/08/2026"]);
});

test("resolveAppointmentWindow: terça 18/08 usa a data explícita", () => {
  const wed = DateTime.fromObject(
    { year: 2026, month: 8, day: 13, hour: 12, minute: 0 },
    { zone: DEFAULT_SCHEDULE_TIMEZONE },
  ).toJSDate();
  const r = resolveAppointmentWindow("terça 18/08", wed, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = DateTime.fromJSDate(r.startUtc, { zone: "utc" }).setZone(DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(s.toISODate(), "2026-08-18");
});

test("expandMultiDayDateExpressions: próximas 3 segundas (após quarta 29/04)", () => {
  // REF = 2026-04-29 (quarta) → próximas segundas: 04/05, 11/05, 18/05
  const dates = expandMultiDayDateExpressions(
    "próximas 3 segundas",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.deepEqual(dates, ["04/05/2026", "11/05/2026", "18/05/2026"]);
});

test("expandMultiDayDateExpressions: as próximas oito terças", () => {
  const dates = expandMultiDayDateExpressions(
    "as próximas oito terças",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.equal(dates.length, 8);
  assert.equal(dates[0], "05/05/2026");
  assert.equal(dates[7], "23/06/2026");
});

test("expandMultiDayDateExpressions: expressão simples permanece única", () => {
  const dates = expandMultiDayDateExpressions("amanhã", REF, DEFAULT_SCHEDULE_TIMEZONE);
  assert.deepEqual(dates, ["amanhã"]);
});

test("expandMultiDayDateExpressions: tz inválido devolve a expressão original", () => {
  const dates = expandMultiDayDateExpressions("próximas 3 segundas", REF, "Invalid/Zone");
  assert.deepEqual(dates, ["próximas 3 segundas"]);
});

test("expandMultiDayDateExpressions: usa o now fornecido (não o relógio do sistema)", () => {
  // REF = quarta 29/04/2026 → 3 segundas a partir daí; independente de Date.now().
  const dates = expandMultiDayDateExpressions(
    "próximas 3 segundas",
    REF,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  assert.deepEqual(dates, ["04/05/2026", "11/05/2026", "18/05/2026"]);
});
