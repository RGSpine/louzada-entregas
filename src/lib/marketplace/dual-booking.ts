import { DateTime } from "luxon";
import {
  AppointmentConfirmationStatus,
  AppointmentSource,
  AppointmentStatus,
  AppointmentVisitKind,
  AppointmentCareSetting,
  type ShowcaseDualBookingStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { APPOINTMENT_STATUSES_FREEING_SLOT } from "@/lib/appointment-status";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { scheduleShowcaseAgendaRefresh } from "@/lib/marketplace/showcase-agenda";
import { isShowcaseEligibleProfession } from "@/lib/marketplace/showcase-eligibility";

const AGENDA_TIMEZONE = "America/Sao_Paulo";

const DURATION_MINUTES = 60;

export type DualLinkStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export function dualStatusFromAppointment(
  status: string,
  confirmationStatus: string,
): DualLinkStatus {
  if (status === "CANCELLED" || status === "NO_SHOW") return "CANCELLED";
  if (confirmationStatus === "CONFIRMED" || status === "COMPLETED") return "CONFIRMED";
  return "PENDING";
}

export function parseConversationSlot(raw: string): Date | null {
  const start = DateTime.fromISO(raw, { zone: AGENDA_TIMEZONE });
  if (!start.isValid) return null;
  return start.toUTC().toJSDate();
}

function formatSlotLabel(startAt: Date): string {
  return DateTime.fromJSDate(startAt, { zone: "utc" })
    .setZone(AGENDA_TIMEZONE)
    .setLocale("pt-BR")
    .toFormat("dd/LL/yyyy, HH:mm");
}

function seatKey(intraUserId: string | null, appointmentId: string): string {
  return intraUserId ? `intra:${intraUserId}` : `appointment:${appointmentId}`;
}

async function assignSeat(input: {
  professionalUserId: string;
  startAt: Date;
  endAt: Date;
}): Promise<{ ok: true; intraUserId: string | null } | { ok: false; error: string }> {
  const [members, busy] = await Promise.all([
    prisma.intraUser.findMany({
      where: { userId: input.professionalUserId },
      select: { id: true, isOwner: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        professionalUserId: input.professionalUserId,
        status: { notIn: [...APPOINTMENT_STATUSES_FREEING_SLOT] },
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
      select: { id: true, intraUserId: true },
    }),
  ]);
  const occupied = new Set(busy.map((row) => seatKey(row.intraUserId, row.id)));
  const capacity = Math.max(1, members.length);
  if (occupied.size >= capacity) {
    return { ok: false, error: "Esse horário já está ocupado na agenda." };
  }
  const freeMember =
    members.find((member) => member.isOwner && !occupied.has(`intra:${member.id}`)) ??
    members.find((member) => !occupied.has(`intra:${member.id}`));
  return { ok: true, intraUserId: freeMember?.id ?? null };
}

async function pushCalendars(professionalUserId: string, appointmentId: string) {
  scheduleGoogleCalendarPush(professionalUserId, appointmentId);
  scheduleShowcaseAgendaRefresh(professionalUserId);
  try {
    const { syncAppointmentWithPatientGoogleCalendar } = await import(
      "@/lib/google-calendar-patient-sync"
    );
    await syncAppointmentWithPatientGoogleCalendar(appointmentId);
  } catch {
    // A agenda interna já foi gravada. O Google do paciente é complementar.
  }
}

export async function mirrorAppointmentOntoDualLink(appointmentId: string): Promise<void> {
  const [appointment, link] = await Promise.all([
    prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { status: true, confirmationStatus: true },
    }),
    prisma.showcaseDualBooking.findUnique({
      where: { appointmentId },
      select: { id: true, status: true },
    }),
  ]);
  if (!link) return;
  const next = appointment
    ? dualStatusFromAppointment(appointment.status, appointment.confirmationStatus)
    : "CANCELLED";
  if (link.status === next) return;
  await prisma.showcaseDualBooking.update({
    where: { id: link.id },
    data: { status: next },
  });
}

export async function createConversationDualBooking(input: {
  profileId: string;
  b2cPatientId: string;
  healthProfileId: string;
  author: "PATIENT" | "PROFESSIONAL";
  startAtRaw: string;
}): Promise<{ success: true; bookingId: string } | { success: false; error: string }> {
  const startAt = parseConversationSlot(input.startAtRaw);
  if (!startAt) return { success: false, error: "Informe dia e horário." };
  const endAt = new Date(startAt.getTime() + DURATION_MINUTES * 60_000);
  if (startAt.getTime() <= Date.now()) {
    return { success: false, error: "Escolha um horário no futuro." };
  }

  const profile = await prisma.professionalProfile.findFirst({
    where: {
      id: input.profileId,
      showcaseApproved: true,
      user: { isBlocked: false },
    },
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, profession: true } },
    },
  });
  if (!profile) {
    return { success: false, error: "Este profissional não está publicado na vitrine." };
  }
  if (!isShowcaseEligibleProfession(profile.user.profession)) {
    return { success: false, error: "Este profissional não está publicado na vitrine." };
  }

  const patient = await prisma.patient.findFirst({
    where: { id: input.b2cPatientId, authUserId: { not: null } },
    select: { id: true, name: true, email: true, phone: true, authUserId: true },
  });
  if (!patient?.authUserId) {
    return { success: false, error: "Conta do paciente não encontrada." };
  }
  const healthProfile = await prisma.healthProfile.findFirst({
    where: { id: input.healthProfileId, patientId: patient.id },
    select: { id: true },
  });
  if (!healthProfile) {
    return { success: false, error: "Perfil de saúde do paciente não encontrado." };
  }

  const patientBusy = await prisma.showcaseDualBooking.findFirst({
    where: {
      b2cPatientId: patient.id,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (patientBusy) {
    return { success: false, error: "Você já tem uma consulta nesse horário." };
  }

  const seat = await assignSeat({
    professionalUserId: profile.userId,
    startAt,
    endAt,
  });
  if (!seat.ok) return seat;

  const email = patient.email?.trim().toLowerCase() || null;
  const chart = email
    ? await prisma.patient.findFirst({
        where: { userId: profile.userId, email },
        select: { id: true },
      })
    : null;
  const chartPatient =
    chart ??
    (await prisma.patient.create({
      data: {
        userId: profile.userId,
        name: sanitizeText(patient.name?.trim() || "Paciente"),
        email,
        phone: patient.phone,
      },
      select: { id: true },
    }));

  const label = formatSlotLabel(startAt);
  const appointment = await prisma.appointment.create({
    data: {
      professionalUserId: profile.userId,
      intraUserId: seat.intraUserId,
      patientId: chartPatient.id,
      startAt,
      endAt,
      timezoneAtBooking: AGENDA_TIMEZONE,
      status: AppointmentStatus.SCHEDULED,
      source: AppointmentSource.MANUAL,
      title: "Consulta combinada na conversa",
      visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
      careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
      confirmationStatus: AppointmentConfirmationStatus.PENDING_CONFIRMATION,
    },
    select: { id: true },
  });

  const booking = await prisma.showcaseDualBooking.create({
    data: {
      professionalProfileId: profile.id,
      b2cPatientId: patient.id,
      healthProfileId: healthProfile.id,
      appointmentId: appointment.id,
      startAt,
      endAt,
      status: "PENDING",
    },
    select: { id: true },
  });

  await prisma.showcaseMessage.create({
    data: {
      professionalProfileId: profile.id,
      patientId: patient.id,
      author: input.author,
      body: sanitizeText(`Consulta marcada para ${label}, nas duas agendas.`),
    },
  });

  await pushCalendars(profile.userId, appointment.id);
  return { success: true, bookingId: booking.id };
}

export async function setDualBookingState(input: {
  bookingId: string;
  actor: "PATIENT" | "PROFESSIONAL";
  actorPatientId?: string;
  actorUserId?: string;
  action: "confirm" | "cancel";
}): Promise<{ success: true } | { success: false; error: string }> {
  const booking = await prisma.showcaseDualBooking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      b2cPatientId: true,
      startAt: true,
      appointmentId: true,
      appointment: { select: { status: true } },
      professionalProfile: { select: { id: true, userId: true } },
    },
  });
  if (!booking) return { success: false, error: "Marcação não encontrada." };
  const owns =
    input.actor === "PATIENT"
      ? booking.b2cPatientId === input.actorPatientId
      : booking.professionalProfile.userId === input.actorUserId;
  if (!owns) return { success: false, error: "Marcação não encontrada." };
  if (booking.status === "CANCELLED" || !booking.appointmentId) {
    return { success: false, error: "Esta consulta já foi desmarcada." };
  }
  if (booking.appointment?.status === "COMPLETED") {
    return { success: false, error: "Esta consulta já foi realizada." };
  }
  if (input.action === "confirm" && booking.status === "CONFIRMED") {
    return { success: true };
  }

  const nextStatus: ShowcaseDualBookingStatus =
    input.action === "cancel" ? "CANCELLED" : "CONFIRMED";
  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: booking.appointmentId },
      data:
        input.action === "cancel"
          ? { status: AppointmentStatus.CANCELLED }
          : { confirmationStatus: AppointmentConfirmationStatus.CONFIRMED },
    }),
    prisma.showcaseDualBooking.update({
      where: { id: booking.id },
      data: { status: nextStatus },
    }),
  ]);

  const label = formatSlotLabel(booking.startAt);
  const sentence =
    input.action === "cancel"
      ? `Consulta de ${label} desmarcada nas duas agendas.`
      : `Consulta de ${label} confirmada nas duas agendas.`;
  await prisma.showcaseMessage.create({
    data: {
      professionalProfileId: booking.professionalProfile.id,
      patientId: booking.b2cPatientId,
      author: input.actor,
      body: sanitizeText(sentence),
    },
  });
  await pushCalendars(booking.professionalProfile.userId, booking.appointmentId);
  return { success: true };
}
