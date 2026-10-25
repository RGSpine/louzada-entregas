import test from "node:test";
import assert from "node:assert/strict";
import { AppointmentSource } from "@prisma/client";
import {
  actionItemDigestUrl,
  appointmentPushDisplayName,
  appointmentPushKind,
  appointmentReminderTitles,
  formatActionItemDigestBody,
  formatActionItemDigestTitle,
  formatAgendaDayDigestBody,
  formatAgendaDayDigestTitle,
  formatAppointmentReminderBody,
} from "./copy";

test("GOOGLE_SYNC prioriza title e não usa paciente fantasma", () => {
  assert.equal(
    appointmentPushDisplayName({
      source: AppointmentSource.GOOGLE_SYNC,
      title: "Bruna",
      patientName: "Ariel",
    }),
    "Bruna",
  );
  assert.equal(
    appointmentPushKind({
      source: AppointmentSource.GOOGLE_SYNC,
      title: "Bruna",
      patientName: "Ariel",
    }),
    "compromisso",
  );
});

test("agendaOnly reforça compromisso mesmo em MANUAL", () => {
  assert.equal(
    appointmentPushKind({
      source: AppointmentSource.MANUAL,
      title: null,
      patientName: "FECHADO",
      agendaOnly: true,
    }),
    "compromisso",
  );
});

test("marcação clínica manual é consulta; TREATMENT_PLAN é sessão", () => {
  assert.equal(
    appointmentPushKind({
      source: AppointmentSource.MANUAL,
      title: null,
      patientName: "Karina",
      agendaOnly: false,
    }),
    "consulta",
  );
  assert.equal(
    appointmentPushKind({
      source: AppointmentSource.VOICE,
      title: null,
      patientName: "Karina",
      visitKind: "TREATMENT_PLAN",
    }),
    "sessao",
  );
});

test("corpo do lembrete não concatena fantasma entre parênteses", () => {
  const displayName = appointmentPushDisplayName({
    source: AppointmentSource.GOOGLE_SYNC,
    title: "Bruna",
    patientName: "Ariel",
  });
  const body = formatAppointmentReminderBody({
    displayName,
    timeLabel: "07/10 às 09:00",
  });
  assert.equal(body, "Bruna — 07/10 às 09:00");
  assert.doesNotMatch(body, /Ariel/);
  assert.doesNotMatch(body, /\(/);
});

test("títulos de lembrete distinguem compromisso e consulta", () => {
  assert.equal(
    appointmentReminderTitles("compromisso").soon,
    "Compromisso em breve",
  );
  assert.equal(appointmentReminderTitles("consulta").soon, "Consulta em breve");
  assert.equal(
    appointmentReminderTitles("sessao").oneHour,
    "Sessão em cerca de 1 hora",
  );
});

test("digest da agenda do dia lista horários e corta com e mais N", () => {
  assert.equal(formatAgendaDayDigestTitle(3), "Agenda de hoje — 3 compromissos");
  assert.equal(formatAgendaDayDigestTitle(1), "Agenda de hoje — 1 compromisso");
  const body = formatAgendaDayDigestBody(
    [
      { time: "09:00", name: "Bruna" },
      { time: "10:00", name: "Caio" },
      { time: "11:00", name: "Ana" },
      { time: "14:00", name: "João" },
      { time: "15:00", name: "Lia" },
      { time: "16:00", name: "Pedro" },
    ],
    5,
  );
  assert.match(body, /^09:00 Bruna/);
  assert.match(body, /e mais 1$/);
  assert.doesNotMatch(body, /16:00 Pedro/);
});

test("digest de action items lista paciente: ação", () => {
  const lines = [
    {
      patientId: "p1",
      patientName: "Karina",
      sampleLabel: "Reavaliar EVA",
      count: 2,
    },
    {
      patientId: "p2",
      patientName: "João",
      sampleLabel: "Pedir exame",
      count: 1,
    },
  ];
  assert.equal(formatActionItemDigestTitle(lines), "Pontos de ação pendentes");
  assert.equal(
    formatActionItemDigestTitle([lines[0]!]),
    "2 pontos de ação — Karina",
  );
  assert.equal(
    formatActionItemDigestBody(lines),
    "Karina: Reavaliar EVA\nJoão: Pedir exame",
  );
  assert.equal(actionItemDigestUrl(lines), "/dashboard/patients");
  assert.equal(
    actionItemDigestUrl([lines[0]!]),
    "/dashboard/patients/p1#evolucao-artifacts",
  );
});
