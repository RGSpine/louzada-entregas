import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cancelAppointmentInputSchema,
  createAppointmentInputSchema,
  listAppointmentsRangeSchema,
  updateAppointmentInputSchema,
} from "@/server/services/appointments";

const START = "2026-07-01T13:00:00.000Z";
const END = "2026-07-01T14:00:00.000Z";

describe("createAppointmentInputSchema (POST /api/v1/agenda/appointments)", () => {
  it("aceita payload válido com patientId", () => {
    const r = createAppointmentInputSchema.safeParse({
      patientId: "pat_123",
      startAt: START,
      endAt: END,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.ok(r.data.startAt instanceof Date);
      assert.ok(r.data.endAt instanceof Date);
    }
  });

  it("aceita payload válido com newPatientName", () => {
    const r = createAppointmentInputSchema.safeParse({
      newPatientName: "Maria Silva",
      startAt: START,
      endAt: END,
      source: "VOICE",
      title: "Avaliação inicial",
    });
    assert.equal(r.success, true);
  });

  it("rejeita quando patientId e newPatientName vêm juntos", () => {
    const r = createAppointmentInputSchema.safeParse({
      patientId: "pat_123",
      newPatientName: "Maria Silva",
      startAt: START,
      endAt: END,
    });
    assert.equal(r.success, false);
  });

  it("rejeita quando nem patientId nem newPatientName são informados", () => {
    const r = createAppointmentInputSchema.safeParse({
      startAt: START,
      endAt: END,
    });
    assert.equal(r.success, false);
  });

  it("rejeita endAt anterior ou igual a startAt", () => {
    const r = createAppointmentInputSchema.safeParse({
      patientId: "pat_123",
      startAt: END,
      endAt: START,
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes("endAt")));
    }
  });

  it("rejeita datas inválidas", () => {
    const r = createAppointmentInputSchema.safeParse({
      patientId: "pat_123",
      startAt: "não-é-data",
      endAt: END,
    });
    assert.equal(r.success, false);
  });

  it("rejeita source fora do enum", () => {
    const r = createAppointmentInputSchema.safeParse({
      patientId: "pat_123",
      startAt: START,
      endAt: END,
      source: "WHATSAPP",
    });
    assert.equal(r.success, false);
  });
});

describe("updateAppointmentInputSchema (PATCH /api/v1/agenda/appointments/[id])", () => {
  it("aceita atualização parcial só com appointmentId + status", () => {
    const r = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      status: "COMPLETED",
    });
    assert.equal(r.success, true);
  });

  it("exige appointmentId", () => {
    const r = updateAppointmentInputSchema.safeParse({ status: "CANCELLED" });
    assert.equal(r.success, false);
  });

  it("rejeita status fora do enum", () => {
    const r = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      status: "DONE",
    });
    assert.equal(r.success, false);
  });

  it("valida endAt > startAt apenas quando ambos presentes", () => {
    const invalid = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      startAt: END,
      endAt: START,
    });
    assert.equal(invalid.success, false);

    const onlyStart = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      startAt: START,
    });
    assert.equal(onlyStart.success, true);
  });

  it("aceita title null (limpar título)", () => {
    const r = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      title: null,
    });
    assert.equal(r.success, true);
  });

  it("exige justificativa ao marcar falta", () => {
    const missing = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      status: "NO_SHOW",
    });
    assert.equal(missing.success, false);

    const short = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      status: "NO_SHOW",
      noShowReason: "ab",
    });
    assert.equal(short.success, false);

    const ok = updateAppointmentInputSchema.safeParse({
      appointmentId: "apt_1",
      status: "NO_SHOW",
      noShowReason: "Paciente desmarcou no mesmo dia por imprevisto familiar.",
    });
    assert.equal(ok.success, true);
  });
});

describe("cancelAppointmentInputSchema (POST .../cancel)", () => {
  it("aceita appointmentId válido", () => {
    assert.equal(
      cancelAppointmentInputSchema.safeParse({ appointmentId: "apt_1" }).success,
      true,
    );
  });

  it("rejeita appointmentId vazio ou ausente", () => {
    assert.equal(cancelAppointmentInputSchema.safeParse({ appointmentId: "" }).success, false);
    assert.equal(cancelAppointmentInputSchema.safeParse({}).success, false);
  });
});

describe("listAppointmentsRangeSchema (GET /api/v1/agenda/appointments?start&end)", () => {
  it("aceita intervalo ISO válido", () => {
    const r = listAppointmentsRangeSchema.safeParse({ start: START, end: END });
    assert.equal(r.success, true);
  });

  it("rejeita end <= start", () => {
    const r = listAppointmentsRangeSchema.safeParse({ start: END, end: START });
    assert.equal(r.success, false);
  });

  it("rejeita datas não-ISO", () => {
    const r = listAppointmentsRangeSchema.safeParse({ start: "ontem", end: END });
    assert.equal(r.success, false);
  });
});
