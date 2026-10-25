import { DateTime } from "luxon";
import { AppointmentStatus, AppointmentConfirmationStatus, type Appointment } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  appointmentPatientDisplayName,
  appointmentRequiresPatientLinkChoice,
  cardNameForSimilarPatientSearch,
  clinicalPatientWhere,
  isAgendaPlaceholderPatient,
} from "@/lib/patient-clinical-scope";
import { assertPatientAccessibleWithScope } from "@/lib/intra-user/patient-access";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";

const WEEKDAY_LABELS_PT_BR = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
] as const;

export const appointmentIdSchema = z.string().min(1, "appointmentId inválido.");

export type AppointmentEvolutionBootstrap = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  registeredPatientName: string;
  isAgendaPlaceholderPatient: boolean;
  requiresPatientLinkChoice: boolean;
  similarSearchName: string;
  patientAge: string | null;
  patientDateOfBirth: string | null;
  patientDiagnosis: string | null;
  patientPhone: string | null;
  patientFatherName: string | null;
  patientMotherName: string | null;
  patientCompanionName: string | null;
  patientCompanionPhone: string | null;
  startAt: string;
  endAt: string;
  timezoneAtBooking: string;
  status: AppointmentStatus;
  title: string | null;
  slotLabel: string;
  attendanceDatePtBr: string;
  existingEvolutionId: string | null;
  canStartEvolution: boolean;
  blockReason?: string;
};

export type AppointmentEvolutionServiceResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

function formatLocalHour(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(tz).toFormat("HH:mm");
}

/** Rótulo pt-BR para banner da Nova Evolução (ex.: "Terça-feira, 15/06 · 14:00–15:00"). */
export function formatAppointmentSlotLabel(
  startAt: Date,
  endAt: Date,
  timezoneIana: string,
): string {
  const tz = timezoneIana.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const start = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(tz);
  const weekday = WEEKDAY_LABELS_PT_BR[start.weekday - 1] ?? start.toFormat("cccc");
  const dayPart = `${weekday}, ${start.toFormat("dd/LL")}`;
  const timePart = `${formatLocalHour(startAt, tz)}–${formatLocalHour(endAt, tz)}`;
  return `${dayPart} · ${timePart}`;
}

export function attendanceDatePtBrFromAppointmentStart(
  startAt: Date,
  timezoneIana: string,
): string {
  const tz = timezoneIana.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  return DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(tz).toFormat("dd/LL/yyyy");
}

type AppointmentWithPatient = Appointment & {
  patient: {
    id: string;
    name: string;
    age: string | null;
    dateOfBirth: Date | null;
    diagnosis: string | null;
    phone: string | null;
    fatherName: string | null;
    motherName: string | null;
    companionName: string | null;
    companionPhone: string | null;
    userId: string | null;
    agendaOnly: boolean;
  };
  evolution: { id: string } | null;
};

export function evaluateAppointmentEvolutionEligibility(
  row: AppointmentWithPatient,
): Pick<AppointmentEvolutionBootstrap, "canStartEvolution" | "existingEvolutionId" | "blockReason"> {
  if (row.status === AppointmentStatus.CANCELLED) {
    return {
      canStartEvolution: false,
      existingEvolutionId: row.evolution?.id ?? null,
      blockReason: "Esta marcação foi cancelada.",
    };
  }
  if (row.status === AppointmentStatus.NO_SHOW) {
    return {
      canStartEvolution: false,
      existingEvolutionId: row.evolution?.id ?? null,
      blockReason: "Esta marcação foi marcada como falta.",
    };
  }
  if (row.evolution) {
    return {
      canStartEvolution: false,
      existingEvolutionId: row.evolution.id,
      blockReason: "Esta marcação já possui evolução registrada.",
    };
  }
  // Perfil clínico só nasce na evolução — e só a partir de marcação Realizada.
  if (row.status !== AppointmentStatus.COMPLETED) {
    return {
      canStartEvolution: false,
      existingEvolutionId: null,
      blockReason:
        "Marque a consulta como Realizada antes de criar a evolução. A ficha em Pacientes só é criada ou vinculada neste passo.",
    };
  }
  return {
    canStartEvolution: true,
    existingEvolutionId: null,
  };
}

function toBootstrap(row: AppointmentWithPatient): AppointmentEvolutionBootstrap {
  const eligibility = evaluateAppointmentEvolutionEligibility(row);
  const displayPatientName = appointmentPatientDisplayName({
    source: row.source,
    title: row.title,
    patientName: row.patient.name,
  });
  const placeholder = isAgendaPlaceholderPatient(row.patient);
  const requiresPatientLinkChoice = appointmentRequiresPatientLinkChoice({
    isAgendaPlaceholderPatient: placeholder,
    displayPatientName,
    registeredPatientName: row.patient.name,
  });
  return {
    appointmentId: row.id,
    patientId: row.patient.id,
    patientName: displayPatientName,
    registeredPatientName: row.patient.name,
    isAgendaPlaceholderPatient: placeholder,
    requiresPatientLinkChoice,
    similarSearchName: cardNameForSimilarPatientSearch(
      displayPatientName,
      row.patient.name,
    ),
    patientAge: row.patient.age,
    patientDateOfBirth: row.patient.dateOfBirth
      ? row.patient.dateOfBirth.toISOString().slice(0, 10)
      : null,
    patientDiagnosis: row.patient.diagnosis,
    patientPhone: row.patient.phone,
    patientFatherName: row.patient.fatherName,
    patientMotherName: row.patient.motherName,
    patientCompanionName: row.patient.companionName,
    patientCompanionPhone: row.patient.companionPhone,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    timezoneAtBooking: row.timezoneAtBooking,
    status: row.status,
    title: row.title,
    slotLabel: formatAppointmentSlotLabel(row.startAt, row.endAt, row.timezoneAtBooking),
    attendanceDatePtBr: attendanceDatePtBrFromAppointmentStart(
      row.startAt,
      row.timezoneAtBooking,
    ),
    existingEvolutionId: eligibility.existingEvolutionId,
    canStartEvolution: eligibility.canStartEvolution,
    blockReason: eligibility.blockReason,
  };
}

export async function loadAppointmentForEvolutionLink(
  professionalUserId: string,
  appointmentId: string,
): Promise<AppointmentEvolutionServiceResult<AppointmentWithPatient>> {
  const parsed = appointmentIdSchema.safeParse(appointmentId);
  if (!parsed.success) {
    return { success: false, error: "Marcação inválida." };
  }

  const row = await prisma.appointment.findFirst({
    where: {
      id: parsed.data,
      professionalUserId,
    },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          age: true,
          dateOfBirth: true,
          diagnosis: true,
          phone: true,
          fatherName: true,
          motherName: true,
          companionName: true,
          companionPhone: true,
          userId: true,
          agendaOnly: true,
        },
      },
      evolution: { select: { id: true } },
    },
  });

  if (!row) {
    return { success: false, error: "Marcação não encontrada ou sem permissão." };
  }

  if (row.patient.userId !== professionalUserId) {
    return { success: false, error: "Marcação não encontrada ou sem permissão." };
  }

  return { success: true, data: row };
}

export async function getAppointmentEvolutionBootstrapForUser(
  professionalUserId: string,
  appointmentId: string,
  options?: { activeIntraUser?: ActiveIntraUser | null },
): Promise<AppointmentEvolutionServiceResult<AppointmentEvolutionBootstrap>> {
  const loaded = await loadAppointmentForEvolutionLink(professionalUserId, appointmentId);
  if (!loaded.success) {
    return loaded;
  }

  // Agenda é compartilhada, mas o bootstrap expõe dados clínicos do paciente —
  // MEMBER só acessa pacientes do próprio escopo (owner ou shared).
  if (options && "activeIntraUser" in options) {
    const access = await assertPatientAccessibleWithScope(
      loaded.data.patientId,
      professionalUserId,
      options.activeIntraUser ?? null,
    );
    if (!access.ok) {
      return { success: false, error: "Marcação não encontrada ou sem permissão." };
    }
  }

  return { success: true, data: toBootstrap(loaded.data) };
}

export async function assertAppointmentReadyForNewEvolution(
  professionalUserId: string,
  appointmentId: string,
  resolvedPatientId: string,
): Promise<AppointmentEvolutionServiceResult<AppointmentWithPatient>> {
  const loaded = await loadAppointmentForEvolutionLink(professionalUserId, appointmentId);
  if (!loaded.success) {
    return loaded;
  }

  const eligibility = evaluateAppointmentEvolutionEligibility(loaded.data);
  if (!eligibility.canStartEvolution) {
    return { success: false, error: eligibility.blockReason ?? "Marcação indisponível." };
  }

  if (loaded.data.patientId !== resolvedPatientId) {
    const resolvedPatient = await prisma.patient.findFirst({
      where: {
        id: resolvedPatientId,
        userId: professionalUserId,
        ...clinicalPatientWhere,
      },
      select: { id: true },
    });
    if (!resolvedPatient) {
      return {
        success: false,
        error: "Paciente selecionado não encontrado ou inválido.",
      };
    }
  }

  return loaded;
}
