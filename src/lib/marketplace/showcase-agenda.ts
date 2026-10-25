import { AppointmentVisitKind, AppointmentCareSetting, AppointmentSource } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { appointmentIntervalsOverlap } from "@/lib/appointment-availability";
import { APPOINTMENT_STATUSES_FREEING_SLOT } from "@/lib/appointment-status";
import { buildIdleSlotWindows, MARKETPLACE_SLOT_MINUTES } from "@/lib/marketplace/slot-grid";
import { sanitizeText } from "@/lib/sanitize";
import { isShowcaseEligibleProfession } from "@/lib/marketplace/showcase-eligibility";

/** Horizonte da busca por dia na vitrine. */
export const SHOWCASE_AGENDA_DAYS = 14;
const TZ = "America/Sao_Paulo";

export type AgendaSeat = {
  id: string;
  startAt: Date;
  endAt: Date;
  intraUserId: string | null;
};

export type AgendaWindow = {
  startAt: Date;
  endAt: Date;
};

/**
 * Um horário fica livre quando ainda há lugar na equipe.
 * Cada profissional da clínica ocupa um lugar; marcação sem profissional também ocupa um.
 */
export function freeAgendaWindows(input: {
  windows: AgendaWindow[];
  appointments: AgendaSeat[];
  capacity: number;
}): AgendaWindow[] {
  const capacity = Math.max(1, input.capacity);
  return input.windows.filter((window) => {
    const seats = new Set<string>();
    for (const appointment of input.appointments) {
      if (
        !appointmentIntervalsOverlap(
          window.startAt,
          window.endAt,
          appointment.startAt,
          appointment.endAt,
        )
      ) {
        continue;
      }
      seats.add(appointment.intraUserId ?? `appointment:${appointment.id}`);
    }
    return seats.size < capacity;
  });
}

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Junta várias gravações da agenda e refaz a projeção uma vez. */
export function scheduleShowcaseAgendaRefresh(userId: string): void {
  const existing = refreshTimers.get(userId);
  if (existing) clearTimeout(existing);
  refreshTimers.set(
    userId,
    setTimeout(() => {
      refreshTimers.delete(userId);
      void refreshShowcaseAgendaOpenings(userId).catch((error) => {
        logger.warn("Falha ao atualizar horários livres da vitrine", {
          feature: "showcase-agenda",
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 800),
  );
}

export async function refreshShowcaseAgendaOpenings(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isBlocked: true,
      professionalProfile: {
        select: {
          id: true,
          showcaseApproved: true,
          offerWindows: {
            where: { isActive: true },
            select: {
              recurrence: true,
              weekdays: true,
              startMinute: true,
              endMinute: true,
              specificDate: true,
            },
          },
        },
      },
    },
  });
  const profile = user?.professionalProfile;
  if (!profile || user.isBlocked || !profile.showcaseApproved) {
    if (profile) {
      await prisma.showcaseAgendaOpening.deleteMany({
        where: { professionalProfileId: profile.id },
      });
    }
    return 0;
  }

  const now = new Date();
  const horizonEnd = DateTime.now().setZone(TZ).plus({ days: SHOWCASE_AGENDA_DAYS }).endOf("day").toJSDate();
  const [teamCount, appointments] = await Promise.all([
    prisma.intraUser.count({ where: { userId } }),
    prisma.appointment.findMany({
      where: {
        professionalUserId: userId,
        status: { notIn: [...APPOINTMENT_STATUSES_FREEING_SLOT] },
        startAt: { lt: horizonEnd },
        endAt: { gt: now },
      },
      select: { id: true, startAt: true, endAt: true, intraUserId: true },
    }),
  ]);

  const grid = buildIdleSlotWindows(
    now,
    SHOWCASE_AGENDA_DAYS,
    TZ,
    profile.offerWindows.map((window) => ({
      recurrence: window.recurrence === "ONCE" ? "ONCE" : "WEEKLY",
      weekdays: window.weekdays,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      specificDate: window.specificDate,
    })),
  );
  const openings = freeAgendaWindows({
    windows: grid.map((item) => ({ startAt: item.startUtc, endAt: item.endUtc })),
    appointments,
    capacity: teamCount,
  });

  await prisma.showcaseAgendaOpening.deleteMany({
    where: { professionalProfileId: profile.id },
  });
  if (openings.length > 0) {
    await prisma.showcaseAgendaOpening.createMany({
      data: openings.map((opening) => ({
        professionalProfileId: profile.id,
        startAt: opening.startAt,
        endAt: opening.endAt,
      })),
    });
  }
  return openings.length;
}

/** Marca o horário livre na agenda do profissional, se ele liberou a marcação. */
export async function bookAgendaOpeningForPatient(input: {
  profileId: string;
  startAt: Date;
  patientId: string;
  patientName: string;
  email: string | null;
  phone: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const opening = await prisma.showcaseAgendaOpening.findFirst({
    where: {
      professionalProfileId: input.profileId,
      startAt: input.startAt,
      endAt: { gt: input.startAt },
    },
    select: {
      startAt: true,
      endAt: true,
      professionalProfile: {
        select: {
          id: true,
          showcaseApproved: true,
          allowPatientAgendaBooking: true,
          userId: true,
          user: { select: { isBlocked: true, profession: true } },
        },
      },
    },
  });
  const profile = opening?.professionalProfile;
  if (
    !opening ||
    !profile ||
    !profile.showcaseApproved ||
    !profile.allowPatientAgendaBooking ||
    profile.user.isBlocked ||
    !isShowcaseEligibleProfession(profile.user.profession) ||
    opening.startAt.getTime() <= Date.now()
  ) {
    return {
      success: false,
      error: "Este horário não está mais livre na agenda.",
    };
  }

  const endAt = new Date(opening.startAt.getTime() + MARKETPLACE_SLOT_MINUTES * 60_000);
  const [team, busy] = await Promise.all([
    prisma.intraUser.findMany({
      where: { userId: profile.userId },
      select: { id: true, isOwner: true },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        professionalUserId: profile.userId,
        status: { notIn: [...APPOINTMENT_STATUSES_FREEING_SLOT] },
        startAt: { lt: endAt },
        endAt: { gt: opening.startAt },
      },
      select: { id: true, startAt: true, endAt: true, intraUserId: true },
    }),
  ]);
  const stillFree = freeAgendaWindows({
    windows: [{ startAt: opening.startAt, endAt }],
    appointments: busy,
    capacity: team.length,
  });
  if (stillFree.length === 0) {
    scheduleShowcaseAgendaRefresh(profile.userId);
    return { success: false, error: "Este horário acabou de ser ocupado." };
  }
  const busyMembers = new Set(
    busy.filter((item) => item.intraUserId).map((item) => item.intraUserId as string),
  );
  const assignee = team.find((member) => !busyMembers.has(member.id)) ?? null;
  if (team.length > 0 && !assignee) {
    return { success: false, error: "Este horário acabou de ser ocupado." };
  }

  const email = input.email?.trim() || null;
  const chart = email
    ? await prisma.patient.findFirst({
        where: { userId: profile.userId, email },
        select: { id: true },
      })
    : null;
  const chartId =
    chart?.id ??
    (
      await prisma.patient.create({
        data: {
          userId: profile.userId,
          name: sanitizeText(input.patientName).slice(0, 200) || "Paciente",
          email,
          phone: input.phone,
        },
        select: { id: true },
      })
    ).id;

  const appointment = await prisma.appointment.create({
    data: {
      professionalUserId: profile.userId,
      intraUserId: assignee?.id ?? null,
      patientId: chartId,
      startAt: opening.startAt,
      endAt,
      source: AppointmentSource.MANUAL,
      title: sanitizeText("Reserva pela vitrine"),
      visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
      careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
      timezoneAtBooking: TZ,
    },
    select: { id: true },
  });
  const { scheduleGoogleCalendarPush } = await import("@/lib/google-calendar-push");
  scheduleGoogleCalendarPush(profile.userId, appointment.id);
  scheduleShowcaseAgendaRefresh(profile.userId);
  return { success: true };
}
