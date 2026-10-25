"use server";

import { z } from "zod";
import { AppointmentSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  findAppointmentOverlap,
  findResourceCapacityOverlap,
} from "@/lib/appointment-availability";
import {
  MARKETPLACE_SLOT_TAKEN_BY_PATIENT,
  RESOURCE_AT_CAPACITY,
  blockYieldSlotsForNativeAppointment,
  findMarketplaceBookedOverlap,
  withAgendaYieldTransaction,
} from "@/lib/marketplace/native-agenda-lock";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { firstZodError } from "@/lib/marketplace/schemas";

const bookInternalSchema = z.object({
  patientId: z.string().min(1, "Informe o paciente."),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  serviceSpaceId: z.string().min(1).nullable().optional(),
  intraUserId: z.string().min(1).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  timezoneAtBooking: z.string().max(80).optional(),
  professionalServiceId: z.string().min(1).nullable().optional(),
});

export type BookInternalAppointmentResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string };

/**
 * Marcação B2B nativa + retirada imediata da oferta de yield (mesma transação).
 * Não sobrescreve BOOKED do marketplace (lock pessimista no slot).
 */
export async function bookInternalAppointment(
  raw: unknown,
): Promise<BookInternalAppointmentResult> {
  const parsed = bookInternalSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) {
    return { success: false, error: "Não autenticado." };
  }

  const professional = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true, isBlocked: true },
  });
  if (!professional || professional.isBlocked) {
    return { success: false, error: "Não autenticado." };
  }

  const {
    patientId,
    startAt,
    endAt,
    serviceSpaceId,
    intraUserId,
    title,
    priceCents,
    timezoneAtBooking,
    professionalServiceId,
  } = parsed.data;

  if (endAt.getTime() <= startAt.getTime()) {
    return { success: false, error: "O término deve ser depois do início." };
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, userId: professional.id },
    select: { id: true },
  });
  if (!patient) {
    return { success: false, error: "Paciente não encontrado." };
  }

  if (serviceSpaceId) {
    const space = await prisma.serviceSpace.findFirst({
      where: { id: serviceSpaceId, userId: professional.id, active: true },
      select: { id: true },
    });
    if (!space) {
      return { success: false, error: "Recurso/sala não encontrado." };
    }
  }

  try {
    const row = await withAgendaYieldTransaction(async (tx) => {
      const market = await findMarketplaceBookedOverlap(
        tx,
        professional.id,
        startAt,
        endAt,
      );
      if (market.overlapping) {
        throw new BookInternalConflictError(MARKETPLACE_SLOT_TAKEN_BY_PATIENT);
      }

      const occupancy = await findAppointmentOverlap(professional.id, startAt, endAt, {
        intraUserId: intraUserId ?? null,
        client: tx,
      });
      if (occupancy.overlapping) {
        throw new BookInternalConflictError(
          "Horário indisponível (conflito com outra marcação).",
        );
      }

      if (serviceSpaceId) {
        const resource = await findResourceCapacityOverlap(
          professional.id,
          serviceSpaceId,
          startAt,
          endAt,
          { client: tx },
        );
        if (resource.overlapping) {
          throw new BookInternalConflictError(RESOURCE_AT_CAPACITY);
        }
      }

      const created = await tx.appointment.create({
        data: {
          professionalUserId: professional.id,
          intraUserId: intraUserId ?? null,
          patientId,
          startAt,
          endAt,
          timezoneAtBooking: timezoneAtBooking ?? DEFAULT_SCHEDULE_TIMEZONE,
          source: AppointmentSource.MANUAL,
          title: title ? sanitizeText(title) : null,
          priceCents: priceCents ?? null,
          professionalServiceId: professionalServiceId ?? null,
          serviceSpaceId: serviceSpaceId ?? null,
        },
        select: { id: true },
      });

      await blockYieldSlotsForNativeAppointment(tx, {
        professionalUserId: professional.id,
        appointmentId: created.id,
        startAt,
        endAt,
        serviceSpaceId,
        priceCents,
      });

      return created;
    });

    scheduleGoogleCalendarPush(professional.id, row.id);
    return { success: true, data: { id: row.id } };
  } catch (error) {
    if (error instanceof BookInternalConflictError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Não foi possível gravar a marcação." };
  }
}

class BookInternalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookInternalConflictError";
  }
}
