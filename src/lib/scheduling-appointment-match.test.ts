import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { resolveTimeOfDayMinutes } from "./schedule-time-expression";
import {
  resolveRescheduleTarget,
  selectAppointmentForCommand,
} from "./scheduling-appointment-match";

const TZ = "America/Sao_Paulo";

function localDate(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toUTC().toJSDate();
}

function dayWindowFor(isoDay: string) {
  const start = DateTime.fromISO(isoDay, { zone: TZ }).startOf("day");
  return { startUtc: start.toUTC().toJSDate(), endUtc: start.plus({ days: 1 }).toUTC().toJSDate() };
}

const NOW = localDate("2026-08-03T09:00");

const anaTomorrow14 = {
  id: "a1",
  startAt: localDate("2026-08-04T14:00"),
  endAt: localDate("2026-08-04T15:00"),
};
const anaTomorrow16 = {
  id: "a2",
  startAt: localDate("2026-08-04T16:00"),
  endAt: localDate("2026-08-04T17:00"),
};
const anaNextWeek = {
  id: "a3",
  startAt: localDate("2026-08-11T10:00"),
  endAt: localDate("2026-08-11T11:00"),
};
const anaPast = {
  id: "a0",
  startAt: localDate("2026-07-20T10:00"),
  endAt: localDate("2026-07-20T11:00"),
};

test("sem marcação ativa devolve erro nomeando o paciente", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [],
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /Ana não tem marcação ativa/);
});

test("sem pistas de data usa a próxima marcação futura", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaNextWeek, anaTomorrow16, anaTomorrow14, anaPast],
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a1");
});

test("dia com uma única marcação dispensa o horário", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaTomorrow14, anaNextWeek],
    dayWindow: dayWindowFor("2026-08-04"),
    dayLabel: "amanhã",
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a1");
});

test("horário exato desempata quando o dia tem várias", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaTomorrow14, anaTomorrow16],
    dayWindow: dayWindowFor("2026-08-04"),
    dayLabel: "amanhã",
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("16h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a2");
});

test("horário sem dia desempata entre as marcações futuras", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaPast, anaTomorrow14, anaTomorrow16, anaNextWeek],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("16h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a2");
});

test("horário sem dia ignora marcação passada no mesmo horário", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    // anaPast e anaNextWeek são ambas 10:00; só a futura pode ser alvo.
    appointments: [anaPast, anaNextWeek],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("10h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a3");
});

test("horário sem dia repetido em dias diferentes usa a próxima ocorrência", () => {
  const anaLater14 = {
    id: "a4",
    startAt: localDate("2026-08-18T14:00"),
    endAt: localDate("2026-08-18T15:00"),
  };
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaLater14, anaTomorrow14],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("14h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a1");
});

test("hora cheia também alcança o slot com minutos dentro dela", () => {
  const ana1430 = {
    id: "a5",
    startAt: localDate("2026-08-04T14:30"),
    endAt: localDate("2026-08-04T15:30"),
  };
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [ana1430, anaTomorrow16],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("14h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  assert.equal(res.ok === true ? res.appointment.id : null, "a5");
});

test("horário com minutos explícitos não alcança outro slot da mesma hora", () => {
  const ana1430 = {
    id: "a5",
    startAt: localDate("2026-08-04T14:30"),
    endAt: localDate("2026-08-04T15:30"),
  };
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [ana1430],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("14:15"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /não tem marcação às 14:15/);
});

test("horário inexistente lista os horários reais em vez de adivinhar", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaTomorrow14, anaNextWeek],
    targetTimeOfDayMinutes: resolveTimeOfDayMinutes("9h"),
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  const error = res.ok === false ? res.error : "";
  assert.match(error, /Ana não tem marcação às 09:00/);
  assert.match(error, /04\/08\/2026 às 14:00/);
  assert.match(error, /11\/08\/2026 às 10:00/);
});

test("dia ambíguo sem horário lista os horários em vez de adivinhar", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaTomorrow14, anaTomorrow16],
    dayWindow: dayWindowFor("2026-08-04"),
    dayLabel: "amanhã",
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  const error = res.ok === false ? res.error : "";
  assert.match(error, /2 marcações nessa data \(amanhã\)/);
  assert.match(error, /14:00/);
  assert.match(error, /16:00/);
});

test("dia sem marcação pede confirmação da data", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaTomorrow14],
    dayWindow: dayWindowFor("2026-08-05"),
    dayLabel: "quarta 05/08/2026",
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  assert.match(
    res.ok === false ? res.error : "",
    /não tem marcação ativa nessa data \(quarta 05\/08\/2026\)/,
  );
});

test("só marcações passadas exige data explícita", () => {
  const res = selectAppointmentForCommand({
    patientName: "Ana",
    appointments: [anaPast],
    now: NOW,
    timezone: TZ,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /marcações passadas/);
});

test("remarcar com nova data e hora preserva a duração", () => {
  const res = resolveRescheduleTarget({
    current: anaTomorrow14,
    newDayWindow: dayWindowFor("2026-08-06"),
    newTimeExpression: "16h",
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.startUtc.getTime(), localDate("2026-08-06T16:00").getTime());
    assert.equal(res.endUtc.getTime(), localDate("2026-08-06T17:00").getTime());
    assert.match(res.label, /06\/08\/2026 às 16:00 \(60 min\)/);
  }
});

test("remarcar só a hora mantém o dia original", () => {
  const res = resolveRescheduleTarget({
    current: anaTomorrow14,
    newTimeExpression: "15:30",
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.startUtc.getTime(), localDate("2026-08-04T15:30").getTime());
    assert.equal(res.endUtc.getTime(), localDate("2026-08-04T16:30").getTime());
  }
});

test("remarcar só o dia mantém a hora original", () => {
  const res = resolveRescheduleTarget({
    current: anaTomorrow14,
    newDayWindow: dayWindowFor("2026-08-07"),
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.startUtc.getTime(), localDate("2026-08-07T14:00").getTime());
  }
});

test("remarcar preserva duração diferente de 60 min", () => {
  const res = resolveRescheduleTarget({
    current: {
      startAt: localDate("2026-08-04T14:00"),
      endAt: localDate("2026-08-04T14:30"),
    },
    newTimeExpression: "18h",
    timezone: TZ,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.endUtc.getTime(), localDate("2026-08-04T18:30").getTime());
  }
});

test("remarcar sem destino e para o mesmo horário são recusados", () => {
  const noTarget = resolveRescheduleTarget({ current: anaTomorrow14, timezone: TZ });
  assert.equal(noTarget.ok, false);
  assert.match(noTarget.ok === false ? noTarget.error : "", /novo dia ou o novo horário/);

  const sameSlot = resolveRescheduleTarget({
    current: anaTomorrow14,
    newTimeExpression: "14h",
    timezone: TZ,
  });
  assert.equal(sameSlot.ok, false);
  assert.match(sameSlot.ok === false ? sameSlot.error : "", /já está em 04\/08\/2026 às 14:00/);
});
