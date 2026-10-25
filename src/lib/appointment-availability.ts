import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APPOINTMENT_STATUSES_FREEING_SLOT } from "@/lib/appointment-status";

/**
 * Intervalos [start, end) em UTC: toque no `end` exato do outro não conta como sobreposição.
 */
export function appointmentIntervalsOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA < endB && endA > startB;
}

export type OverlapCheckResult = {
  overlapping: boolean;
  conflictingAppointmentId?: string;
};

/**
 * Marcações `CANCELLED` e `NO_SHOW` não ocupam slot.
 */
export async function findAppointmentOverlap(
  professionalUserId: string,
  startAt: Date,
  endAt: Date,
  options?: {
    excludeAppointmentId?: string;
    /** Quem atende. Null = titular sem Intra User. Omitir = overlap de todo o tenant (legado). */
    intraUserId?: string | null;
    client?: Prisma.TransactionClient;
  },
): Promise<OverlapCheckResult> {
  const db = options?.client ?? prisma;
  const where: Prisma.AppointmentWhereInput = {
    professionalUserId,
    status: { notIn: [...APPOINTMENT_STATUSES_FREEING_SLOT] },
    startAt: { lt: endAt },
    endAt: { gt: startAt },
    ...(options?.excludeAppointmentId
      ? { id: { not: options.excludeAppointmentId } }
      : {}),
    ...(options && "intraUserId" in options
      ? { intraUserId: options.intraUserId ?? null }
      : {}),
  };

  const row = await db.appointment.findFirst({
    where,
    select: { id: true },
  });

  return {
    overlapping: !!row,
    conflictingAppointmentId: row?.id,
  };
}

export async function findResourceCapacityOverlap(
  professionalUserId: string,
  serviceSpaceId: string,
  startAt: Date,
  endAt: Date,
  options?: { excludeAppointmentId?: string; client?: Prisma.TransactionClient },
): Promise<OverlapCheckResult> {
  const db = options?.client ?? prisma;
  const space = await db.serviceSpace.findFirst({
    where: { id: serviceSpaceId, userId: professionalUserId },
    select: { capacity: true },
  });
  if (!space) {
    return { overlapping: true };
  }

  const count = await db.appointment.count({
    where: {
      professionalUserId,
      serviceSpaceId,
      status: { notIn: [...APPOINTMENT_STATUSES_FREEING_SLOT] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(options?.excludeAppointmentId
        ? { id: { not: options.excludeAppointmentId } }
        : {}),
    },
  });

  return { overlapping: count >= space.capacity };
}
