import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { findAppointmentOverlap } from "@/lib/appointment-availability";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  appointmentCareSettingSchema,
  appointmentNotesSchema,
} from "@/lib/appointment-fields-schema";
import {
  formatSuggestedSlotsMessage,
  suggestAlternativeSlots,
  type SuggestedSlot,
} from "@/lib/appointment-suggested-slots";
import {
  buildTreatmentPlanBatchSlots,
  findInternalBatchSlotOverlap,
  mapPurchaseToBatchCandidate,
  TREATMENT_PLAN_BATCH_DEFAULTS,
  type TreatmentPlanBatchCandidate,
} from "@/lib/appointment-treatment-plan-batch";
import { PatientServiceSessionStatus } from "@prisma/client";

export const generateTreatmentPlanBatchInputSchema = z
  .object({
    purchaseId: z.string().min(1),
    firstStartAt: z.coerce.date(),
    durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
    intervalDays: z.coerce.number().int().min(1).max(90).default(7),
    timezoneAtBooking: z.string().min(1).max(64).optional(),
    careSetting: appointmentCareSettingSchema.optional(),
    notes: appointmentNotesSchema,
    maxSessions: z.coerce.number().int().min(1).max(52).optional(),
  })
  .refine((d) => d.durationMinutes > 0, {
    message: "Duração inválida.",
    path: ["durationMinutes"],
  });

export type AppointmentBatchServiceResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string; suggestedSlots?: SuggestedSlot[] };

export async function listTreatmentPlanBatchCandidatesForUser(
  userId: string,
  patientId?: string,
): Promise<AppointmentBatchServiceResult<TreatmentPlanBatchCandidate[]>> {
  const purchases = await prisma.patientServicePurchase.findMany({
    where: {
      professionalUserId: userId,
      ...(patientId ? { patientId } : {}),
      sessions: {
        some: {
          status: PatientServiceSessionStatus.PENDING,
          appointment: { is: null },
        },
      },
    },
    orderBy: [{ purchasedAt: "desc" }],
    select: {
      id: true,
      patientId: true,
      agreedPriceCents: true,
      sessionCountTotal: true,
      purchasedAt: true,
      patient: { select: { name: true } },
      service: { select: { name: true } },
      sessions: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          status: true,
          allocatedPriceCents: true,
          appointment: { select: { id: true } },
        },
      },
    },
  });

  const data = purchases
    .map((row) => mapPurchaseToBatchCandidate(row))
    .filter((row): row is TreatmentPlanBatchCandidate => row !== null);

  return { success: true, data };
}

export async function generateTreatmentPlanAppointmentsForUser(
  userId: string,
  input: unknown,
): Promise<
  AppointmentBatchServiceResult<{
    createdIds: string[];
    createdCount: number;
    firstStartAt: Date;
    lastStartAt: Date;
  }>
> {
  const parsed = generateTreatmentPlanBatchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const {
    purchaseId,
    firstStartAt,
    durationMinutes,
    intervalDays,
    timezoneAtBooking,
    careSetting,
    notes,
    maxSessions,
  } = parsed.data;

  const tz = timezoneAtBooking ?? DEFAULT_SCHEDULE_TIMEZONE;

  const purchase = await prisma.patientServicePurchase.findFirst({
    where: { id: purchaseId, professionalUserId: userId },
    select: {
      id: true,
      patientId: true,
      professionalServiceId: true,
      patient: { select: { name: true } },
      service: { select: { name: true } },
      agreedPriceCents: true,
      sessionCountTotal: true,
      purchasedAt: true,
      sessions: {
        where: {
          status: PatientServiceSessionStatus.PENDING,
          appointment: { is: null },
        },
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          allocatedPriceCents: true,
          status: true,
          appointment: { select: { id: true } },
        },
      },
    },
  });

  if (!purchase) {
    return { success: false, error: "Pacote de serviço não encontrado." };
  }

  const candidate = mapPurchaseToBatchCandidate({
    ...purchase,
    patientId: purchase.patientId,
  });
  if (!candidate || candidate.sessions.length === 0) {
    return {
      success: false,
      error: "Não há sessões pendentes sem marcação neste pacote de serviço.",
    };
  }

  const sessionsToSchedule = maxSessions
    ? candidate.sessions.slice(0, maxSessions)
    : candidate.sessions;

  const slots = buildTreatmentPlanBatchSlots({
    sessions: sessionsToSchedule,
    firstStartAt,
    durationMinutes,
    intervalDays,
    timezone: tz,
  });

  const internalConflict = findInternalBatchSlotOverlap(slots);
  if (internalConflict) {
    return { success: false, error: internalConflict };
  }

  for (const slot of slots) {
    const overlap = await findAppointmentOverlap(userId, slot.startAt, slot.endAt);
    if (overlap.overlapping) {
      const suggestions = await suggestAlternativeSlots({
        professionalUserId: userId,
        preferredStartUtc: slot.startAt,
        durationMinutes,
        timezone: tz,
      });
      return {
        success: false,
        error:
          `Horário indisponível para sessão ${slot.sequence} (${slot.label}) — conflito com outra marcação.` +
          formatSuggestedSlotsMessage(suggestions),
        suggestedSlots: suggestions,
      };
    }
  }

  const notesSanitized = notes ? sanitizeText(notes) : null;
  const care = careSetting ?? TREATMENT_PLAN_BATCH_DEFAULTS.careSetting;
  const title = sanitizeText(`${candidate.serviceName} — pacote`);

  const createdIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const slot of slots) {
      const row = await tx.appointment.create({
        data: {
          professionalUserId: userId,
          patientId: purchase.patientId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          timezoneAtBooking: tz,
          status: TREATMENT_PLAN_BATCH_DEFAULTS.status,
          source: TREATMENT_PLAN_BATCH_DEFAULTS.source,
          title,
          visitKind: TREATMENT_PLAN_BATCH_DEFAULTS.visitKind,
          careSetting: care,
          priceCents: slot.priceCents > 0 ? slot.priceCents : null,
          notes: notesSanitized,
          patientServiceSessionId: slot.sessionId,
          professionalServiceId: purchase.professionalServiceId,
          confirmationStatus: TREATMENT_PLAN_BATCH_DEFAULTS.confirmationStatus,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  });

  for (const id of createdIds) {
    scheduleGoogleCalendarPush(userId, id);
  }

  return {
    success: true,
    data: {
      createdIds,
      createdCount: createdIds.length,
      firstStartAt: slots[0]!.startAt,
      lastStartAt: slots[slots.length - 1]!.startAt,
    },
  };
}
