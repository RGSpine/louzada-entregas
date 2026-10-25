import { AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { releaseExpiredMarketplaceHolds } from "@/lib/marketplace/holds";
import { syncProfessionalPostgisLocation } from "@/lib/marketplace/location";
import {
  LEGACY_SPECIALTY_SLUG_ALIASES,
  MARKETPLACE_SPECIALTY_CATALOG,
  MARKETPLACE_SPECIALTY_SLUGS,
  specialtySlugFromProfession,
} from "@/lib/marketplace/specialties";
import {
  centsToReais,
  rangesOverlap,
} from "@/lib/marketplace/slot-grid";
import { computeDiscountPrice } from "@/lib/marketplace/yield-apply";
import { canUseYieldManagement } from "@/lib/plan-limits";

export type MarketplaceSyncSummary = {
  profiles: number;
  slotsCreated: number;
  slotsBlocked: number;
  slotsReleased: number;
  yieldApplied: number;
  locationsWritten: number;
};

const EMPTY_SUMMARY: MarketplaceSyncSummary = {
  profiles: 0,
  slotsCreated: 0,
  slotsBlocked: 0,
  slotsReleased: 0,
  yieldApplied: 0,
  locationsWritten: 0,
};

function addSummary(
  total: MarketplaceSyncSummary,
  part: MarketplaceSyncSummary,
): MarketplaceSyncSummary {
  return {
    profiles: total.profiles + part.profiles,
    slotsCreated: total.slotsCreated + part.slotsCreated,
    slotsBlocked: total.slotsBlocked + part.slotsBlocked,
    slotsReleased: total.slotsReleased + part.slotsReleased,
    yieldApplied: total.yieldApplied + part.yieldApplied,
    locationsWritten: total.locationsWritten + part.locationsWritten,
  };
}

export async function seedMarketplaceSpecialties(): Promise<number> {
  let upserts = 0;
  for (const item of MARKETPLACE_SPECIALTY_CATALOG) {
    await prisma.specialty.upsert({
      where: { slug: item.slug },
      update: { name: item.name, description: item.description, active: true },
      create: {
        slug: item.slug,
        name: item.name,
        description: item.description,
        active: true,
      },
    });
    upserts += 1;
  }

  for (const [legacySlug, nextSlug] of Object.entries(LEGACY_SPECIALTY_SLUG_ALIASES)) {
    const [legacy, next] = await Promise.all([
      prisma.specialty.findUnique({ where: { slug: legacySlug }, select: { id: true } }),
      prisma.specialty.findUnique({ where: { slug: nextSlug }, select: { id: true } }),
    ]);
    if (!legacy || !next) continue;

    const links = await prisma.professionalSpecialty.findMany({
      where: { specialtyId: legacy.id },
      select: { professionalProfileId: true },
    });
    for (const link of links) {
      await prisma.professionalSpecialty.upsert({
        where: {
          professionalProfileId_specialtyId: {
            professionalProfileId: link.professionalProfileId,
            specialtyId: next.id,
          },
        },
        update: {},
        create: {
          professionalProfileId: link.professionalProfileId,
          specialtyId: next.id,
        },
      });
    }
    await prisma.professionalSpecialty.deleteMany({ where: { specialtyId: legacy.id } });
  }

  await prisma.specialty.updateMany({
    where: { slug: { notIn: [...MARKETPLACE_SPECIALTY_SLUGS] } },
    data: { active: false },
  });

  return upserts;
}

async function ensureProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      profession: true,
      officeAddress: true,
      plan: true,
      email: true,
      isInfluencer: true,
      professionalProfile: {
        select: {
          id: true,
          latitude: true,
          longitude: true,
          yieldManagementEnabled: true,
        },
      },
    },
  });
  if (!user) return null;

  const profile =
    user.professionalProfile ??
    (await prisma.professionalProfile.create({
      data: { userId: user.id },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        yieldManagementEnabled: true,
      },
    }));

  return { user, profile };
}

async function ensureSpecialtyLink(profileId: string, profession: string | null) {
  const slug = specialtySlugFromProfession(profession);
  const specialty = await prisma.specialty.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!specialty) return;
  await prisma.professionalSpecialty.upsert({
    where: {
      professionalProfileId_specialtyId: {
        professionalProfileId: profileId,
        specialtyId: specialty.id,
      },
    },
    update: {},
    create: {
      professionalProfileId: profileId,
      specialtyId: specialty.id,
    },
  });
}

export async function syncProfessionalMarketplace(
  userId: string,
): Promise<MarketplaceSyncSummary> {
  const summary: MarketplaceSyncSummary = { ...EMPTY_SUMMARY, profiles: 1 };
  const ensured = await ensureProfile(userId);
  if (!ensured) return { ...EMPTY_SUMMARY };

  const { user, profile } = ensured;
  const yieldOn =
    profile.yieldManagementEnabled &&
    canUseYieldManagement(user.plan, user.email, user.isInfluencer);
  await seedMarketplaceSpecialties();
  await ensureSpecialtyLink(profile.id, user.profession);

  const wroteLocation = await syncProfessionalPostgisLocation({
    profileId: profile.id,
    officeAddress: user.officeAddress,
    latitude: profile.latitude,
    longitude: profile.longitude,
  });
  if (wroteLocation) summary.locationsWritten = 1;

  await releaseExpiredMarketplaceHolds(prisma);

  const now = new Date();
  const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  const [appointments, services, existingSlots, rules] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        professionalUserId: userId,
        status: AppointmentStatus.SCHEDULED,
        startAt: { lt: horizon },
        endAt: { gt: now },
      },
      select: { id: true, startAt: true, endAt: true, priceCents: true },
    }),
    prisma.professionalService.findFirst({
      where: { userId, active: true },
      orderBy: { updatedAt: "desc" },
      select: { defaultPriceCents: true },
    }),
    prisma.scheduleSlot.findMany({
      where: {
        professionalProfileId: profile.id,
        datetime: { gte: now },
      },
      select: {
        id: true,
        datetime: true,
        endAt: true,
        status: true,
        appointmentId: true,
        holdExpiresAt: true,
        basePrice: true,
        manualOffer: true,
      },
    }),
    prisma.yieldRule.findMany({
      where: { professionalProfileId: profile.id, isActive: true },
      select: {
        id: true,
        hoursBeforeTrigger: true,
        discountPercentage: true,
      },
    }),
  ]);

  const slotByStart = new Map(
    existingSlots.map((slot) => [slot.datetime.toISOString(), slot]),
  );

  // Opt-in apenas: remove ofertas automáticas (não manuais / não reservadas).
  const autoAvailable = [...slotByStart.values()].filter(
    (slot) => slot.status === "AVAILABLE" && !slot.manualOffer,
  );
  if (autoAvailable.length > 0) {
    await prisma.scheduleSlot.deleteMany({
      where: { id: { in: autoAvailable.map((slot) => slot.id) } },
    });
    for (const slot of autoAvailable) {
      slotByStart.delete(slot.datetime.toISOString());
    }
    summary.slotsReleased += autoAvailable.length;
  }

  const claimedAppointmentIds = new Set<string>();
  const slotByAppointmentId = new Map<string, (typeof existingSlots)[number]>();
  for (const slot of slotByStart.values()) {
    if (slot.appointmentId) {
      slotByAppointmentId.set(slot.appointmentId, slot);
    }
  }

  // Remarcação: o slot antigo ainda segura appointment_id único — move a ponte.
  for (const appointment of appointments) {
    const linked = slotByAppointmentId.get(appointment.id);
    if (!linked) continue;
    const appointmentPrice = centsToReais(
      appointment.priceCents ?? services?.defaultPriceCents,
    );
    const oldKey = linked.datetime.toISOString();
    const newKey = appointment.startAt.toISOString();
    const occupant = slotByStart.get(newKey);

    if (occupant && occupant.id !== linked.id) {
      if (occupant.status === "BOOKED") {
        claimedAppointmentIds.add(appointment.id);
        continue;
      }
      // Destino já tem slot: limpa a ponte antiga e reutiliza o destino.
      await prisma.scheduleSlot.update({
        where: { id: linked.id },
        data: {
          appointmentId: null,
          status: linked.manualOffer ? "AVAILABLE" : "BLOCKED",
        },
      });
      slotByStart.set(oldKey, { ...linked, appointmentId: null });
      await prisma.scheduleSlot.update({
        where: { id: occupant.id },
        data: {
          status: "BLOCKED",
          appointmentId: appointment.id,
          patientId: null,
          holdExpiresAt: null,
          yieldActive: false,
          discountPrice: null,
          yieldRuleId: null,
          endAt: appointment.endAt,
          basePrice: appointmentPrice,
        },
      });
      const updated = {
        ...occupant,
        status: "BLOCKED" as const,
        appointmentId: appointment.id,
        endAt: appointment.endAt,
        basePrice: occupant.basePrice,
      };
      slotByStart.set(newKey, updated);
      slotByAppointmentId.set(appointment.id, updated);
    } else if (
      linked.datetime.getTime() !== appointment.startAt.getTime() ||
      linked.endAt.getTime() !== appointment.endAt.getTime() ||
      linked.status !== "BLOCKED" ||
      linked.appointmentId !== appointment.id
    ) {
      await prisma.scheduleSlot.update({
        where: { id: linked.id },
        data: {
          datetime: appointment.startAt,
          endAt: appointment.endAt,
          status: "BLOCKED",
          appointmentId: appointment.id,
          patientId: null,
          holdExpiresAt: null,
          yieldActive: false,
          discountPrice: null,
          yieldRuleId: null,
          basePrice: appointmentPrice,
        },
      });
      if (oldKey !== newKey) slotByStart.delete(oldKey);
      const moved = {
        ...linked,
        datetime: appointment.startAt,
        endAt: appointment.endAt,
        status: "BLOCKED" as const,
        appointmentId: appointment.id,
      };
      slotByStart.set(newKey, moved);
      slotByAppointmentId.set(appointment.id, moved);
    }

    claimedAppointmentIds.add(appointment.id);
    summary.slotsBlocked += 1;
  }

  const liveSlotsSnapshot = [...slotByStart.values()];

  for (const slot of liveSlotsSnapshot) {
    if (slot.status === "BOOKED") {
      const appointment = appointments.find(
        (item) =>
          !claimedAppointmentIds.has(item.id) &&
          rangesOverlap(slot.datetime, slot.endAt, item.startAt, item.endAt),
      );
      if (appointment) claimedAppointmentIds.add(appointment.id);
      continue;
    }
    const appointment = appointments.find(
      (item) =>
        !claimedAppointmentIds.has(item.id) &&
        rangesOverlap(slot.datetime, slot.endAt, item.startAt, item.endAt),
    );
    if (!appointment) continue;
    claimedAppointmentIds.add(appointment.id);
    if (slot.status === "BLOCKED" && slot.appointmentId === appointment.id) continue;

    // Liberta appointment_id se outra linha ainda o tiver (legado).
    const previousOwner = slotByAppointmentId.get(appointment.id);
    if (previousOwner && previousOwner.id !== slot.id) {
      await prisma.scheduleSlot.update({
        where: { id: previousOwner.id },
        data: { appointmentId: null },
      });
      slotByStart.set(previousOwner.datetime.toISOString(), {
        ...previousOwner,
        appointmentId: null,
      });
    }

    await prisma.scheduleSlot.update({
      where: { id: slot.id },
      data: {
        status: "BLOCKED",
        appointmentId: appointment.id,
        patientId: null,
        holdExpiresAt: null,
        yieldActive: false,
        discountPrice: null,
        yieldRuleId: null,
        endAt: appointment.endAt,
        basePrice: centsToReais(appointment.priceCents ?? services?.defaultPriceCents),
      },
    });
    const updated = {
      ...slot,
      status: "BLOCKED" as const,
      appointmentId: appointment.id,
      endAt: appointment.endAt,
    };
    slotByStart.set(slot.datetime.toISOString(), updated);
    slotByAppointmentId.set(appointment.id, updated);
    summary.slotsBlocked += 1;
  }

  for (const appointment of appointments) {
    if (claimedAppointmentIds.has(appointment.id)) continue;
    const key = appointment.startAt.toISOString();
    const existing = slotByStart.get(key);
    const appointmentPrice = centsToReais(appointment.priceCents ?? services?.defaultPriceCents);
    if (existing) {
      if (existing.status === "BOOKED") continue;
      const previousOwner = slotByAppointmentId.get(appointment.id);
      if (previousOwner && previousOwner.id !== existing.id) {
        await prisma.scheduleSlot.update({
          where: { id: previousOwner.id },
          data: { appointmentId: null },
        });
      }
      await prisma.scheduleSlot.update({
        where: { id: existing.id },
        data: {
          status: "BLOCKED",
          appointmentId: appointment.id,
          patientId: null,
          holdExpiresAt: null,
          yieldActive: false,
          discountPrice: null,
          yieldRuleId: null,
          endAt: appointment.endAt,
          basePrice: appointmentPrice,
        },
      });
      const updated = {
        ...existing,
        status: "BLOCKED" as const,
        appointmentId: appointment.id,
        endAt: appointment.endAt,
      };
      slotByStart.set(key, updated);
      slotByAppointmentId.set(appointment.id, updated);
    } else {
      const orphan = slotByAppointmentId.get(appointment.id);
      if (orphan) {
        await prisma.scheduleSlot.update({
          where: { id: orphan.id },
          data: {
            datetime: appointment.startAt,
            endAt: appointment.endAt,
            status: "BLOCKED",
            appointmentId: appointment.id,
            patientId: null,
            holdExpiresAt: null,
            yieldActive: false,
            discountPrice: null,
            yieldRuleId: null,
            basePrice: appointmentPrice,
          },
        });
        slotByStart.delete(orphan.datetime.toISOString());
        const moved = {
          ...orphan,
          datetime: appointment.startAt,
          endAt: appointment.endAt,
          status: "BLOCKED" as const,
          appointmentId: appointment.id,
        };
        slotByStart.set(key, moved);
        slotByAppointmentId.set(appointment.id, moved);
      } else {
        const created = await prisma.scheduleSlot.create({
          data: {
            professionalProfileId: profile.id,
            datetime: appointment.startAt,
            endAt: appointment.endAt,
            status: "BLOCKED",
            appointmentId: appointment.id,
            basePrice: appointmentPrice,
          },
          select: {
            id: true,
            datetime: true,
            endAt: true,
            status: true,
            appointmentId: true,
            holdExpiresAt: true,
            basePrice: true,
            manualOffer: true,
          },
        });
        slotByStart.set(key, created);
        slotByAppointmentId.set(appointment.id, created);
      }
    }
    claimedAppointmentIds.add(appointment.id);
    summary.slotsBlocked += 1;
  }

  const staleBlocked = [...slotByStart.values()].filter(
    (slot) =>
      slot.status === "BLOCKED" &&
      (slot.appointmentId == null || !claimedAppointmentIds.has(slot.appointmentId)),
  );
  if (staleBlocked.length > 0) {
    const restoreManual = staleBlocked.filter((slot) => slot.manualOffer);
    const dropAuto = staleBlocked.filter((slot) => !slot.manualOffer);

    if (dropAuto.length > 0) {
      await prisma.scheduleSlot.deleteMany({
        where: { id: { in: dropAuto.map((slot) => slot.id) } },
      });
    }

    if (restoreManual.length > 0 && yieldOn) {
      const rule = rules[0];
      const pct = rule ? Number(rule.discountPercentage) : 30;
      for (const slot of restoreManual) {
        const discountPrice = computeDiscountPrice(Number(slot.basePrice), pct);
        await prisma.scheduleSlot.update({
          where: { id: slot.id },
          data: {
            status: "AVAILABLE",
            appointmentId: null,
            yieldActive: true,
            discountPrice,
            yieldRuleId: rule?.id ?? null,
            patientId: null,
            holdExpiresAt: null,
          },
        });
      }
    } else if (restoreManual.length > 0) {
      await prisma.scheduleSlot.deleteMany({
        where: { id: { in: restoreManual.map((slot) => slot.id) } },
      });
    }

    summary.slotsReleased += staleBlocked.length;
  }

  // Só ofertas opt-in (manual / voz) recebem desconto — nunca grade automática.
  if (yieldOn && rules[0]) {
    const rule = rules[0];
    const pct = Number(rule.discountPercentage);
    const manualSlots = await prisma.scheduleSlot.findMany({
      where: {
        professionalProfileId: profile.id,
        status: "AVAILABLE",
        manualOffer: true,
        datetime: { gt: now },
      },
      select: { id: true, basePrice: true, yieldActive: true, yieldRuleId: true },
    });
    for (const slot of manualSlots) {
      const discountPrice = computeDiscountPrice(Number(slot.basePrice), pct);
      if (!slot.yieldActive || slot.yieldRuleId !== rule.id) {
        await prisma.scheduleSlot.update({
          where: { id: slot.id },
          data: {
            yieldActive: true,
            discountPrice,
            yieldRuleId: rule.id,
          },
        });
        summary.yieldApplied += 1;
      }
    }
  } else {
    await prisma.scheduleSlot.updateMany({
      where: {
        professionalProfileId: profile.id,
        status: "AVAILABLE",
        OR: [{ yieldActive: true }, { yieldRuleId: { not: null } }],
      },
      data: {
        yieldActive: false,
        discountPrice: null,
        yieldRuleId: null,
      },
    });
  }

  return summary;
}

export async function runMarketplaceYieldJob(): Promise<MarketplaceSyncSummary> {
  await seedMarketplaceSpecialties();
  await releaseExpiredMarketplaceHolds(prisma);

  const users = await prisma.user.findMany({
    where: {
      isBlocked: false,
      OR: [
        { professionalProfile: { isNot: null } },
        { officeAddress: { not: null } },
      ],
    },
    select: { id: true },
  });

  let total = { ...EMPTY_SUMMARY };
  for (const user of users) {
    try {
      const part = await syncProfessionalMarketplace(user.id);
      total = addSummary(total, part);
    } catch (error) {
      logger.warn("Sync marketplace falhou para profissional", {
        feature: "marketplace-yield-job",
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("Job marketplace yield concluído", {
    feature: "marketplace-yield-job",
    ...total,
  });
  return total;
}

export async function enableDefaultYieldForUser(userId: string): Promise<MarketplaceSyncSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, email: true, isInfluencer: true },
  });
  if (!user || !canUseYieldManagement(user.plan, user.email, user.isInfluencer)) {
    return { ...EMPTY_SUMMARY };
  }

  const profile = await prisma.professionalProfile.upsert({
    where: { userId },
    create: { userId, yieldManagementEnabled: true },
    update: { yieldManagementEnabled: true },
    select: { id: true },
  });

  const existing = await prisma.yieldRule.findFirst({
    where: { professionalProfileId: profile.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    await prisma.yieldRule.update({
      where: { id: existing.id },
      data: {
        hoursBeforeTrigger: 24,
        discountPercentage: 30,
        isActive: true,
      },
    });
  } else {
    await prisma.yieldRule.create({
      data: {
        professionalProfileId: profile.id,
        hoursBeforeTrigger: 24,
        discountPercentage: 30,
        isActive: true,
      },
    });
  }

  const windowCount = await prisma.yieldOfferWindow.count({
    where: { professionalProfileId: profile.id, isActive: true },
  });
  if (windowCount === 0) {
    await prisma.yieldOfferWindow.create({
      data: {
        professionalProfileId: profile.id,
        label: "Horário comercial",
        recurrence: "WEEKLY",
        weekdays: [1, 2, 3, 4, 5, 6],
        startMinute: 8 * 60,
        endMinute: 18 * 60,
        isActive: true,
      },
    });
  }

  return syncProfessionalMarketplace(userId);
}

export function scheduleMarketplaceSlotSync(userId: string): void {
  void syncProfessionalMarketplace(userId)
    .catch((error) => {
      logger.warn("Ponte agenda→slot falhou (best-effort)", {
        feature: "marketplace-agenda-bridge",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      void import("@/lib/marketplace/showcase-agenda").then((mod) => {
        mod.scheduleShowcaseAgendaRefresh(userId);
      });
    });
}
