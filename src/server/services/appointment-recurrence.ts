import { z } from "zod";
import {
  AppointmentConfirmationStatus,
  AppointmentSource,
  AppointmentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAppointmentOverlap, findResourceCapacityOverlap } from "@/lib/appointment-availability";
import { findInternalBatchSlotOverlap } from "@/lib/appointment-treatment-plan-batch";
import {
  buildRecurrenceSlots,
  MAX_RECURRENCE_SESSIONS,
  MIN_RECURRENCE_SESSIONS,
} from "@/lib/appointment-recurrence";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { logger } from "@/lib/logger";
import {
  formatSuggestedSlotsMessage,
  suggestAlternativeSlots,
  type SuggestedSlot,
} from "@/lib/appointment-suggested-slots";
import {
  MARKETPLACE_SLOT_TAKEN_BY_PATIENT,
  RESOURCE_AT_CAPACITY,
  blockYieldSlotsForNativeAppointment,
  findMarketplaceBookedOverlap,
  withAgendaYieldTransaction,
} from "@/lib/marketplace/native-agenda-lock";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";

export const recurrenceWeekdaysSchema = z
  .array(z.coerce.number().int().min(1).max(7))
  .min(1, "Selecione pelo menos um dia da semana.")
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: "Dias da semana duplicados.",
  });

export const generateAppointmentSeriesInputSchema = z.object({
  appointmentId: z.string().min(1),
  sessionCount: z.coerce.number().int().min(MIN_RECURRENCE_SESSIONS).max(MAX_RECURRENCE_SESSIONS),
  weekdays: recurrenceWeekdaysSchema,
  durationMinutes: z.coerce.number().int().min(15).max(180),
  startAt: z.coerce.date().optional(),
  timezoneAtBooking: z.string().min(1).max(64).optional(),
});

export const createRecurrenceFieldsSchema = z.object({
  recurrenceSessionCount: z.coerce
    .number()
    .int()
    .min(MIN_RECURRENCE_SESSIONS)
    .max(MAX_RECURRENCE_SESSIONS)
    .optional(),
  recurrenceWeekdays: recurrenceWeekdaysSchema.optional(),
});

export type AppointmentSeriesServiceResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; suggestedSlots?: SuggestedSlot[] };

/** Transação longa só para writes de Appointment — sem statement_timeout de 8s do yield. */
async function withSeriesWriteTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 15_000,
    timeout: 60_000,
  });
}

async function assertSlotsAvailable(params: {
  userId: string;
  slots: Array<{ startAt: Date; endAt: Date; label: string }>;
  durationMinutes: number;
  timezone: string;
  excludeAppointmentId?: string;
  intraUserId?: string | null;
  serviceSpaceId?: string | null;
}): Promise<AppointmentSeriesServiceResult<never> | null> {
  const internalConflict = findInternalBatchSlotOverlap(params.slots);
  if (internalConflict) {
    return { success: false, error: internalConflict };
  }

  for (const slot of params.slots) {
    const overlap = await findAppointmentOverlap(params.userId, slot.startAt, slot.endAt, {
      excludeAppointmentId: params.excludeAppointmentId,
      ...(params.intraUserId !== undefined ? { intraUserId: params.intraUserId } : {}),
    });
    if (overlap.overlapping) {
      const suggestions = await suggestAlternativeSlots({
        professionalUserId: params.userId,
        preferredStartUtc: slot.startAt,
        durationMinutes: params.durationMinutes,
        timezone: params.timezone,
      });
      return {
        success: false,
        error:
          `Horário indisponível em ${slot.label} — conflito com outra marcação.` +
          formatSuggestedSlotsMessage(suggestions),
        suggestedSlots: suggestions,
      };
    }

    if (params.serviceSpaceId) {
      const resourceBusy = await findResourceCapacityOverlap(
        params.userId,
        params.serviceSpaceId,
        slot.startAt,
        slot.endAt,
        { excludeAppointmentId: params.excludeAppointmentId },
      );
      if (resourceBusy.overlapping) {
        return { success: false, error: `${RESOURCE_AT_CAPACITY} (${slot.label})` };
      }
    }
  }

  // Marketplace: leituras leves no client (sem statement_timeout de 8s do yield).
  try {
    for (const slot of params.slots) {
      const market = await findMarketplaceBookedOverlap(
        prisma,
        params.userId,
        slot.startAt,
        slot.endAt,
      );
      if (market.overlapping) {
        return { success: false, error: MARKETPLACE_SLOT_TAKEN_BY_PATIENT };
      }
    }
  } catch (error) {
    logger.warn("Checagem marketplace na série ignorada", {
      feature: "appointment-series",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}


/** Bloqueio de yield best-effort, fora da série (não derruba a marcação). */
async function bestEffortBlockYieldSlots(
  userId: string,
  items: Array<{
    appointmentId: string;
    startAt: Date;
    endAt: Date;
    serviceSpaceId?: string | null;
    priceCents?: number | null;
  }>,
): Promise<void> {
  for (const item of items) {
    try {
      await withAgendaYieldTransaction(async (tx) => {
        await blockYieldSlotsForNativeAppointment(tx, {
          professionalUserId: userId,
          appointmentId: item.appointmentId,
          startAt: item.startAt,
          endAt: item.endAt,
          serviceSpaceId: item.serviceSpaceId,
          priceCents: item.priceCents,
        });
      });
    } catch (error) {
      logger.warn("Yield lock pós-série falhou (best-effort)", {
        feature: "appointment-series",
        appointmentId: item.appointmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Fixa a marcação atual e gera as demais sessões da série (mesmo horário, dias escolhidos).
 * Não vincula sessões de pacote nas ocorrências extras.
 */
export async function generateAppointmentSeriesForUser(
  userId: string,
  input: unknown,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<
  AppointmentSeriesServiceResult<{
    seriesId: string;
    createdIds: string[];
    createdCount: number;
    totalCount: number;
    firstStartAt: Date;
    lastStartAt: Date;
  }>
> {
  const parsed = generateAppointmentSeriesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const { appointmentId, sessionCount, weekdays, durationMinutes, startAt, timezoneAtBooking } =
    parsed.data;

  const memberScope =
    activeIntraUser && activeIntraUser.role === "MEMBER"
      ? {
          OR: [
            { intraUserId: activeIntraUser.id },
            {
              patient: {
                OR: [{ ownerId: activeIntraUser.id }, { isShared: true }],
              },
            },
          ],
        }
      : {};

  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      professionalUserId: userId,
      ...memberScope,
    },
  });
  if (!existing) {
    return { success: false, error: "Marcação não encontrada." };
  }
  if (existing.status !== AppointmentStatus.SCHEDULED) {
    return { success: false, error: "Só é possível gerar série a partir de uma marcação agendada." };
  }
  if (existing.recurrenceSeriesId) {
    return { success: false, error: "Esta marcação já faz parte de uma série fixa." };
  }

  const tz = timezoneAtBooking ?? existing.timezoneAtBooking ?? DEFAULT_SCHEDULE_TIMEZONE;
  const firstStart = startAt ?? existing.startAt;

  let slots;
  try {
    slots = buildRecurrenceSlots({
      firstStartAt: firstStart,
      durationMinutes,
      sessionCount,
      weekdays,
      timezone: tz,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Não foi possível montar a série.",
    };
  }

  const blocked = await assertSlotsAvailable({
    userId,
    slots,
    durationMinutes,
    timezone: tz,
    excludeAppointmentId: appointmentId,
    intraUserId: existing.intraUserId,
    serviceSpaceId: existing.serviceSpaceId,
  });
  if (blocked) return blocked;

  const extraSlots = slots.slice(1);
  const seriesId = crypto.randomUUID();

  const createdIds = await withSeriesWriteTransaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        startAt: slots[0]!.startAt,
        endAt: slots[0]!.endAt,
        timezoneAtBooking: tz,
        recurrenceSeriesId: seriesId,
      },
    });

    const ids: string[] = [];
    for (const slot of extraSlots) {
      const created = await tx.appointment.create({
        data: {
          professionalUserId: userId,
          intraUserId: existing.intraUserId,
          patientId: existing.patientId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          timezoneAtBooking: tz,
          status: AppointmentStatus.SCHEDULED,
          source: existing.source ?? AppointmentSource.MANUAL,
          title: existing.title,
          visitKind: existing.visitKind,
          careSetting: existing.careSetting,
          priceCents: existing.priceCents,
          notes: existing.notes,
          professionalServiceId: existing.professionalServiceId,
          serviceSpaceId: existing.serviceSpaceId,
          confirmationStatus: AppointmentConfirmationStatus.PENDING_CONFIRMATION,
          recurrenceSeriesId: seriesId,
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    return ids;
  });

  scheduleGoogleCalendarPush(userId, appointmentId);
  for (const id of createdIds) {
    scheduleGoogleCalendarPush(userId, id);
  }

  void bestEffortBlockYieldSlots(
    userId,
    [
      {
        appointmentId,
        startAt: slots[0]!.startAt,
        endAt: slots[0]!.endAt,
        serviceSpaceId: existing.serviceSpaceId,
        priceCents: existing.priceCents,
      },
      ...createdIds.map((id, index) => ({
        appointmentId: id,
        startAt: extraSlots[index]!.startAt,
        endAt: extraSlots[index]!.endAt,
        serviceSpaceId: existing.serviceSpaceId,
        priceCents: existing.priceCents,
      })),
    ],
  );

  return {
    success: true,
    data: {
      seriesId,
      createdIds,
      createdCount: createdIds.length,
      totalCount: slots.length,
      firstStartAt: slots[0]!.startAt,
      lastStartAt: slots[slots.length - 1]!.startAt,
    },
  };
}

export type SeriesCreateSlotMeta = {
  professionalUserId: string;
  intraUserId: string | null;
  patientId: string;
  timezoneAtBooking: string;
  source: AppointmentSource;
  title: string | null;
  visitKind: import("@prisma/client").AppointmentVisitKind;
  careSetting: import("@prisma/client").AppointmentCareSetting;
  priceCents: number | null;
  notes: string | null;
  professionalServiceId: string | null;
  serviceSpaceId: string | null;
  patientServiceSessionId: string | null;
  confirmationStatus: AppointmentConfirmationStatus;
};

/**
 * Cria a 1ª marcação + extras da série numa única transaction (sem yield lock interno).
 */
export async function createAppointmentSeriesRows(params: {
  userId: string;
  slots: Array<{ startAt: Date; endAt: Date }>;
  meta: SeriesCreateSlotMeta;
}): Promise<{ seriesId: string; ids: string[] }> {
  const seriesId = crypto.randomUUID();
  const ids = await withSeriesWriteTransaction(async (tx) => {
    const created: string[] = [];
    for (let i = 0; i < params.slots.length; i++) {
      const slot = params.slots[i]!;
      const row = await tx.appointment.create({
        data: {
          professionalUserId: params.meta.professionalUserId,
          intraUserId: params.meta.intraUserId,
          patientId: params.meta.patientId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          timezoneAtBooking: params.meta.timezoneAtBooking,
          status: AppointmentStatus.SCHEDULED,
          source: params.meta.source,
          title: params.meta.title,
          visitKind: params.meta.visitKind,
          careSetting: params.meta.careSetting,
          priceCents: params.meta.priceCents,
          notes: params.meta.notes,
          // Só a 1ª pode carregar sessão de pacote.
          patientServiceSessionId: i === 0 ? params.meta.patientServiceSessionId : null,
          professionalServiceId: params.meta.professionalServiceId,
          serviceSpaceId: params.meta.serviceSpaceId,
          confirmationStatus: params.meta.confirmationStatus,
          recurrenceSeriesId: seriesId,
        },
        select: { id: true },
      });
      created.push(row.id);
    }
    return created;
  });

  void bestEffortBlockYieldSlots(
    params.userId,
    ids.map((id, index) => ({
      appointmentId: id,
      startAt: params.slots[index]!.startAt,
      endAt: params.slots[index]!.endAt,
      serviceSpaceId: params.meta.serviceSpaceId,
      priceCents: params.meta.priceCents,
    })),
  );

  return { seriesId, ids };
}

export { assertSlotsAvailable, buildRecurrenceSlots };
