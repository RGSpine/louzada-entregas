import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyMarketplaceLockTimeouts } from "@/lib/marketplace/holds";
import { centsToReais, rangesOverlap } from "@/lib/marketplace/slot-grid";

export const MARKETPLACE_SLOT_TAKEN_BY_PATIENT =
  "Este horário já está reservado no marketplace.";

export const RESOURCE_AT_CAPACITY =
  "Este recurso (sala/equipamento) já está no limite de capacidade neste horário.";

type LockClient = Prisma.TransactionClient | typeof prisma;

export async function findMarketplaceBookedOverlap(
  client: LockClient,
  professionalUserId: string,
  startAt: Date,
  endAt: Date,
): Promise<{ overlapping: boolean; slotId?: string }> {
  const slots = await client.scheduleSlot.findMany({
    where: {
      professional: { userId: professionalUserId },
      status: "BOOKED",
      datetime: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, datetime: true, endAt: true },
  });
  const hit = slots.find((slot) =>
    rangesOverlap(startAt, endAt, slot.datetime, slot.endAt),
  );
  return { overlapping: Boolean(hit), slotId: hit?.id };
}

/**
 * Remove a oferta B2C no mesmo instante em que a agenda nativa ocupa o horário.
 * Não sobrescreve BOOKED (paciente do marketplace).
 */
export async function blockYieldSlotsForNativeAppointment(
  client: LockClient,
  params: {
    professionalUserId: string;
    appointmentId: string;
    startAt: Date;
    endAt: Date;
    serviceSpaceId?: string | null;
    priceCents?: number | null;
  },
): Promise<{ blocked: number; created: boolean }> {
  const profile = await client.professionalProfile.findUnique({
    where: { userId: params.professionalUserId },
    select: { id: true },
  });
  if (!profile) return { blocked: 0, created: false };

  const overlapping = await client.scheduleSlot.findMany({
    where: {
      professionalProfileId: profile.id,
      datetime: { lt: params.endAt },
      endAt: { gt: params.startAt },
    },
    select: { id: true, status: true, datetime: true, endAt: true },
  });

  const toBlock = overlapping.filter(
    (slot) =>
      slot.status !== "BOOKED" &&
      rangesOverlap(params.startAt, params.endAt, slot.datetime, slot.endAt),
  );

  const exactExisting = toBlock.find(
    (slot) => slot.datetime.getTime() === params.startAt.getTime(),
  );
  const others = toBlock.filter((slot) => slot.id !== exactExisting?.id);

  if (others.length > 0) {
    await client.scheduleSlot.updateMany({
      where: { id: { in: others.map((slot) => slot.id) } },
      data: {
        status: "BLOCKED",
        yieldActive: false,
        discountPrice: null,
        yieldRuleId: null,
        holdExpiresAt: null,
        patientId: null,
      },
    });
  }

  if (exactExisting) {
    await client.scheduleSlot.update({
      where: { id: exactExisting.id },
      data: {
        status: "BLOCKED",
        appointmentId: params.appointmentId,
        yieldActive: false,
        discountPrice: null,
        yieldRuleId: null,
        holdExpiresAt: null,
        patientId: null,
        serviceSpaceId: params.serviceSpaceId ?? undefined,
        endAt: params.endAt,
      },
    });
    return { blocked: toBlock.length, created: false };
  }

  await client.scheduleSlot.create({
    data: {
      professionalProfileId: profile.id,
      datetime: params.startAt,
      endAt: params.endAt,
      status: "BLOCKED",
      appointmentId: params.appointmentId,
      serviceSpaceId: params.serviceSpaceId ?? null,
      basePrice: centsToReais(params.priceCents),
    },
  });
  return { blocked: toBlock.length, created: true };
}

export async function activateYieldOnFreedWindow(
  professionalUserId: string,
  startAt: Date,
  endAt: Date,
  discountYield: number,
): Promise<void> {
  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professionalUserId },
    select: { id: true, yieldManagementEnabled: true },
  });
  if (!profile) return;

  const base = await prisma.scheduleSlot.findFirst({
    where: {
      professionalProfileId: profile.id,
      datetime: startAt,
    },
    select: { id: true, basePrice: true, status: true },
  });

  const pct = Math.min(90, Math.max(1, discountYield));
  const discountPrice = base
    ? Math.round(Number(base.basePrice) * (1 - pct / 100) * 100) / 100
    : Math.round(150 * (1 - pct / 100) * 100) / 100;

  if (base && base.status !== "BOOKED") {
    await prisma.scheduleSlot.update({
      where: { id: base.id },
      data: {
        status: "AVAILABLE",
        appointmentId: null,
        manualOffer: true,
        yieldActive: true,
        discountPrice,
        holdExpiresAt: null,
        patientId: null,
      },
    });
    return;
  }

  if (!base) {
    await prisma.scheduleSlot.create({
      data: {
        professionalProfileId: profile.id,
        datetime: startAt,
        endAt,
        status: "AVAILABLE",
        manualOffer: true,
        yieldActive: true,
        discountPrice,
        basePrice: 150,
      },
    });
  }
}

export async function withAgendaYieldTransaction<T>(
  fn: (tx: LockClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await applyMarketplaceLockTimeouts(tx);
      return fn(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 12_000,
    },
  );
}
