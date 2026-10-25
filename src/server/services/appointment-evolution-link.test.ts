import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AppointmentStatus,
  AppointmentSource,
  AppointmentVisitKind,
  AppointmentCareSetting,
  AppointmentConfirmationStatus,
} from "@prisma/client";
import {
  evaluateAppointmentEvolutionEligibility,
  formatAppointmentSlotLabel,
  attendanceDatePtBrFromAppointmentStart,
} from "@/server/services/appointment-evolution-link";
import { appointmentPatientDisplayName } from "@/lib/patient-clinical-scope";

const START = new Date("2026-06-15T17:00:00.000Z");
const END = new Date("2026-06-15T18:00:00.000Z");
const TZ = "America/Sao_Paulo";

function mockAppointmentRow(
  overrides: Partial<{
    status: AppointmentStatus;
    evolution: { id: string } | null;
  }> = {},
) {
  return {
    id: "apt_1",
    professionalUserId: "user_1",
    intraUserId: null,
    patientId: "pat_1",
    startAt: START,
    endAt: END,
    timezoneAtBooking: TZ,
    status: AppointmentStatus.SCHEDULED,
    source: "MANUAL" as const,
    title: null,
    googleCalendarEventId: null,
    googleCalendarUpdatedAt: null,
    visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
    careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
    priceCents: null,
    notes: null,
    patientServiceSessionId: null,
    professionalServiceId: null,
    confirmationStatus: AppointmentConfirmationStatus.PENDING_CONFIRMATION,
    noShowReason: null,
    recurrenceSeriesId: null,
    serviceSpaceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    patient: {
      id: "pat_1",
      name: "Maria",
      age: "30",
      diagnosis: null,
      userId: "user_1",
      agendaOnly: false,
      dateOfBirth: null,
      phone: null,
      fatherName: null,
      motherName: null,
      companionName: null,
      companionPhone: null,
    },
    evolution: null,
    ...overrides,
  };
}

describe("formatAppointmentSlotLabel", () => {
  it("formata dia e horário em pt-BR", () => {
    const label = formatAppointmentSlotLabel(START, END, TZ);
    assert.match(label, /· 14:00–15:00/);
    assert.match(label, /15\/06/);
  });
});

describe("attendanceDatePtBrFromAppointmentStart", () => {
  it("retorna dd/LL/yyyy no fuso da marcação", () => {
    assert.equal(attendanceDatePtBrFromAppointmentStart(START, TZ), "15/06/2026");
  });
});

describe("evaluateAppointmentEvolutionEligibility", () => {
  it("bloqueia evolução em marcação ainda agendada (exige Realizada)", () => {
    const r = evaluateAppointmentEvolutionEligibility(mockAppointmentRow());
    assert.equal(r.canStartEvolution, false);
    assert.match(r.blockReason ?? "", /Realizada/i);
  });

  it("bloqueia marcação cancelada", () => {
    const r = evaluateAppointmentEvolutionEligibility(
      mockAppointmentRow({ status: AppointmentStatus.CANCELLED }),
    );
    assert.equal(r.canStartEvolution, false);
    assert.match(r.blockReason ?? "", /cancelada/i);
  });

  it("bloqueia marcação marcada como falta", () => {
    const r = evaluateAppointmentEvolutionEligibility(
      mockAppointmentRow({ status: AppointmentStatus.NO_SHOW }),
    );
    assert.equal(r.canStartEvolution, false);
    assert.match(r.blockReason ?? "", /falta/i);
  });

  it("bloqueia quando já existe evolução", () => {
    const r = evaluateAppointmentEvolutionEligibility(
      mockAppointmentRow({
        status: AppointmentStatus.COMPLETED,
        evolution: { id: "evo_1" },
      }),
    );
    assert.equal(r.canStartEvolution, false);
    assert.equal(r.existingEvolutionId, "evo_1");
  });

  it("permite evolução em marcação já realizada sem evolução", () => {
    const r = evaluateAppointmentEvolutionEligibility(
      mockAppointmentRow({ status: AppointmentStatus.COMPLETED }),
    );
    assert.equal(r.canStartEvolution, true);
  });
});

describe("appointmentPatientDisplayName na evolução", () => {
  it("prioriza título do Google em vez do placeholder", () => {
    const name = appointmentPatientDisplayName({
      source: AppointmentSource.GOOGLE_SYNC,
      title: "Eduardo",
      patientName: "Compromisso (Google Agenda)",
    });
    assert.equal(name, "Eduardo");
  });
});
