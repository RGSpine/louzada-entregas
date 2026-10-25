"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getExistingB2cPatientViewer } from "@/lib/b2c/patient-session";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sanitizeText } from "@/lib/sanitize";
import { getRequestClientIp } from "@/lib/request-client-ip";
import {
  enforceRateLimit,
  MARKETPLACE_BOOK_RATE_LIMIT,
  MARKETPLACE_SEARCH_RATE_LIMIT,
} from "@/lib/rate-limit";
import {
  SLOT_TAKEN_MESSAGE,
  MAX_MARKETPLACE_SEARCH_ROWS,
  bookScheduleSlotSchema,
  firstZodError,
  groupMarketplaceSearchRows,
  searchProfessionalsSchema,
  toMoneyNumber,
  type MarketplaceProfessional,
  type MarketplaceSearchRow,
} from "@/lib/marketplace/schemas";
import { isShowcaseEligibleProfession } from "@/lib/marketplace/showcase-eligibility";
import { SLOT_HOLD_MINUTES } from "@/lib/marketplace/paths";
import { matchingSpecialtySlugs } from "@/lib/marketplace/specialties";
import {
  applyMarketplaceLockTimeouts,
  isLockContentionError,
  releaseExpiredMarketplaceHolds,
} from "@/lib/marketplace/holds";
import { findAppointmentOverlap } from "@/lib/appointment-availability";
import { scheduleGoogleCalendarPush } from "@/lib/google-calendar-push";
import {
  AppointmentCareSetting,
  AppointmentSource,
  AppointmentVisitKind,
} from "@prisma/client";

export type SearchProfessionalsResult =
  | { success: true; data: MarketplaceProfessional[]; count: number }
  | { success: false; error: string };

export type BookScheduleSlotResult =
  | {
      success: true;
      data: {
        slotId: string;
        datetime: string;
        endAt: string;
        yieldActive: boolean;
        basePrice: number;
        discountPrice: number | null;
        effectivePrice: number;
        professionalName: string;
      };
    }
  | { success: false; error: string };

type LockedSlotRow = {
  id: string;
  status: string;
  patientId: string | null;
  holdExpiresAt: Date | null;
  datetime: Date;
  endAt: Date;
  yieldActive: boolean;
  basePrice: unknown;
  discountPrice: unknown;
  professionalName: string | null;
};

function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function marketplaceUnavailableMessage(error: unknown): string | null {
  if (!isPrismaKnownError(error)) return null;
  if (error.code === "P2021" || error.code === "P2010") {
    return "Marketplace indisponível no momento.";
  }
  return null;
}

function isPostgisUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("st_dwithin") ||
    message.includes("ST_DWithin") ||
    message.includes("geography") ||
    message.includes("undefined_function")
  );
}

async function getMarketplaceRateLimitKey(
  prefix: string,
  fallbackId?: string | null,
): Promise<string> {
  const hdrs = await headers();
  const ip = getRequestClientIp(hdrs);
  return `${prefix}:${(fallbackId || ip || "anon").toLowerCase()}`;
}

async function getAuthUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function resolveMarketplacePatientId(authUser: {
  id: string;
  email?: string | null;
  phone?: string | null;
  user_metadata?: Record<string, unknown>;
}): Promise<string> {
  const existing = await prisma.patient.findUnique({
    where: { authUserId: authUser.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const metadata = authUser.user_metadata ?? {};
  const rawName =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    authUser.email?.split("@")[0] ||
    "Paciente";
  const name = sanitizeText(rawName).slice(0, 200) || "Paciente";
  const rawPhone =
    (typeof metadata.phone === "string" && metadata.phone) ||
    authUser.phone ||
    "";
  const phone = sanitizeText(rawPhone).slice(0, 32) || null;

  try {
    const created = await prisma.patient.create({
      data: {
        authUserId: authUser.id,
        email: authUser.email ?? null,
        phone,
        name,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (isPrismaKnownError(error) && error.code === "P2002") {
      const raced = await prisma.patient.findUnique({
        where: { authUserId: authUser.id },
        select: { id: true },
      });
      if (raced) return raced.id;
    }
    throw error;
  }
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function diagnoseBookingConflict(slot: LockedSlotRow | undefined): string {
  if (!slot) return "Horário não encontrado.";
  if (slot.status === "BLOCKED") return "Este horário não está disponível.";
  if (asDate(slot.datetime).getTime() <= Date.now()) return "Este horário já passou.";
  if (slot.status === "BOOKED" || slot.patientId) return SLOT_TAKEN_MESSAGE;
  return SLOT_TAKEN_MESSAGE;
}

/**
 * Busca B2C: especialidade + raio (km) via PostGIS `ST_DWithin`.
 * Prisma não expressa geo nativamente — a query é SQL parametrizado.
 * Horários com `yieldActive` vêm primeiro (desconto de ociosidade).
 */
export async function searchProfessionals(
  raw: unknown,
): Promise<SearchProfessionalsResult> {
  const parsed = searchProfessionalsSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const viewer = await getExistingB2cPatientViewer();
  if (!viewer) {
    return {
      success: false,
      error: "Entre na conta de paciente para buscar por local e horários.",
    };
  }

  const { latitude, longitude, specialty, radiusKm } = parsed.data;
  const specialtySlugs = matchingSpecialtySlugs(specialty);
  if (specialtySlugs.length === 0) {
    return { success: true, data: [], count: 0 };
  }
  const rl = await enforceRateLimit(
    await getMarketplaceRateLimitKey("marketplace-search"),
    MARKETPLACE_SEARCH_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return {
      success: false,
      error: `Muitas buscas. Tente em ${rl.resetIn}s.`,
    };
  }

  const radiusMeters = radiusKm * 1000;

  try {
    await releaseExpiredMarketplaceHolds(prisma);

    const rows = await prisma.$queryRaw<MarketplaceSearchRow[]>`
      SELECT
        pp.id AS "profileId",
        pp.user_id AS "userId",
        u.name AS "professionalName",
        u.profession,
        u."avatarUrl" AS "avatarUrl",
        u.image,
        pp.public_photo_url AS "publicPhotoUrl",
        pp.public_bio AS "publicBio",
        pp.public_headline AS "publicHeadline",
        pp.maps_url AS "mapsUrl",
        pp.city,
        pp.state,
        pp.neighborhood,
        pp.latitude,
        pp.longitude,
        pp.yield_management_enabled AS "yieldManagementEnabled",
        ST_Distance(
          pp.location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        ) AS "distanceMeters",
        s.id AS "specialtyId",
        s.name AS "specialtyName",
        s.slug AS "specialtySlug",
        ss.id AS "slotId",
        ss.datetime AS "datetime",
        ss.end_at AS "endAt",
        ss.base_price AS "basePrice",
        ss.yield_active AS "yieldActive",
        ss.discount_price AS "discountPrice"
      FROM "ProfessionalProfile" pp
      INNER JOIN "User" u ON u.id = pp.user_id
      INNER JOIN "ProfessionalSpecialty" ps ON ps.professional_profile_id = pp.id
      INNER JOIN "Specialty" s ON s.id = ps.specialty_id
      INNER JOIN "ScheduleSlot" ss ON ss.professional_profile_id = pp.id
      WHERE pp.location IS NOT NULL
        AND pp.showcase_approved = true
        AND u."isBlocked" = false
        AND u.profession IS DISTINCT FROM 'Estudante'
        AND s.active = true
        AND (
          s.slug IN (${Prisma.join(specialtySlugs)})
          OR lower(s.name) = lower(${specialty})
        )
        AND ss.status = 'AVAILABLE'
        AND ss.manual_offer = true
        AND ss.datetime > NOW()
        AND ST_DWithin(
          pp.location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY
        ss.yield_active DESC,
        ST_Distance(
          pp.location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        ) ASC,
        ss.datetime ASC
      LIMIT ${MAX_MARKETPLACE_SEARCH_ROWS}
    `;

    const data = groupMarketplaceSearchRows(rows);
    return { success: true, data, count: data.length };
  } catch (error) {
    logger.error("Falha na busca geográfica do marketplace", {
      feature: "marketplace-search",
      error: error instanceof Error ? error.message : String(error),
    });
    if (isPostgisUnavailable(error)) {
      return {
        success: false,
        error: "Busca geográfica indisponível. Tente novamente em instantes.",
      };
    }
    return {
      success: false,
      error:
        marketplaceUnavailableMessage(error) ??
        "Não foi possível buscar profissionais agora.",
    };
  }
}

/**
 * Reserva B2C com lock pessimista (SELECT … FOR UPDATE) + UPDATE condicional.
 * Dois cliques no mesmo milissegundo: só a primeira transação confirma;
 * a segunda recebe "Horário recém-reservado".
 */
export async function bookScheduleSlot(
  raw: unknown,
): Promise<BookScheduleSlotResult> {
  const parsed = bookScheduleSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const authUser = await getAuthUser();
  if (!authUser) {
    return { success: false, error: "Faça login para reservar o horário." };
  }

  const rl = await enforceRateLimit(
    await getMarketplaceRateLimitKey("marketplace-book", authUser.id),
    MARKETPLACE_BOOK_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return {
      success: false,
      error: `Muitas reservas. Tente em ${rl.resetIn}s.`,
    };
  }

  const { slotId } = parsed.data;

  try {
    const patientId = await resolveMarketplacePatientId(authUser);

    const booked = await prisma.$transaction(
      async (tx) => {
        /**
         * FOR UPDATE só vive até o COMMIT (não “para sempre”).
         * lock_timeout local evita espera/deadlock longo; hold_expires_at
         * devolve o slot ao yield se a confirmação/pagamento não ocorrer.
         */
        await applyMarketplaceLockTimeouts(tx);
        await releaseExpiredMarketplaceHolds(tx);

        const updated = await tx.$executeRaw`
          WITH locked AS (
            SELECT id
            FROM "ScheduleSlot"
            WHERE id = ${slotId}
            FOR UPDATE
          )
          UPDATE "ScheduleSlot" AS s
          SET
            status = 'BOOKED',
            patient_id = ${patientId},
            hold_expires_at = NOW() + (${SLOT_HOLD_MINUTES} * INTERVAL '1 minute'),
            updated_at = CURRENT_TIMESTAMP
          FROM locked
          WHERE s.id = locked.id
            AND s.status = 'AVAILABLE'
            AND s.manual_offer = true
            AND s.patient_id IS NULL
            AND s.datetime > NOW()
        `;

        const [slot] = await tx.$queryRaw<LockedSlotRow[]>`
          SELECT
            s.id,
            s.status::text AS status,
            s.patient_id AS "patientId",
            s.hold_expires_at AS "holdExpiresAt",
            s.datetime,
            s.end_at AS "endAt",
            s.yield_active AS "yieldActive",
            s.base_price AS "basePrice",
            s.discount_price AS "discountPrice",
            u.name AS "professionalName"
          FROM "ScheduleSlot" s
          INNER JOIN "ProfessionalProfile" pp ON pp.id = s.professional_profile_id
          INNER JOIN "User" u ON u.id = pp.user_id
          WHERE s.id = ${slotId}
        `;

        if (Number(updated) !== 1) {
          throw new BookingConflictError(diagnoseBookingConflict(slot));
        }

        if (!slot || slot.patientId !== patientId || slot.status !== "BOOKED") {
          throw new BookingConflictError(SLOT_TAKEN_MESSAGE);
        }

        const basePrice = toMoneyNumber(slot.basePrice);
        const discountPrice =
          slot.discountPrice == null ? null : toMoneyNumber(slot.discountPrice);
        const effectivePrice =
          slot.yieldActive && discountPrice != null ? discountPrice : basePrice;

        return {
          slotId: slot.id,
          datetime: asDate(slot.datetime).toISOString(),
          endAt: asDate(slot.endAt).toISOString(),
          yieldActive: Boolean(slot.yieldActive),
          basePrice,
          discountPrice,
          effectivePrice,
          professionalName: slot.professionalName?.trim() || "Profissional",
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );

    return { success: true, data: booked };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { success: false, error: error.message };
    }

    if (isLockContentionError(error)) {
      return { success: false, error: SLOT_TAKEN_MESSAGE };
    }

    if (isPrismaKnownError(error)) {
      if (error.code === "P2002" || error.code === "P2034") {
        return { success: false, error: SLOT_TAKEN_MESSAGE };
      }
      const unavailable = marketplaceUnavailableMessage(error);
      if (unavailable) return { success: false, error: unavailable };
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Transaction already closed") || message.includes("timeout")) {
      return {
        success: false,
        error: "Não foi possível reservar. Tente novamente.",
      };
    }

    logger.error("Falha ao reservar horário do marketplace", {
      feature: "marketplace-book",
      error: message,
    });
    return {
      success: false,
      error: "Não foi possível reservar este horário.",
    };
  }
}

export type MarketplaceReservationView =
  | {
      success: true;
      data: {
        slotId: string;
        status: "held" | "confirmed";
        datetime: string;
        endAt: string;
        holdExpiresAt: string | null;
        yieldActive: boolean;
        basePrice: number;
        discountPrice: number | null;
        effectivePrice: number;
        professionalName: string;
      };
    }
  | { success: false; error: string };

async function loadReservationView(
  slotId: string,
  patientId: string,
): Promise<MarketplaceReservationView> {
  const [slot] = await prisma.$queryRaw<
    Array<
      LockedSlotRow & {
        appointmentId: string | null;
      }
    >
  >`
    SELECT
      s.id,
      s.status::text AS status,
      s.patient_id AS "patientId",
      s.hold_expires_at AS "holdExpiresAt",
      s.datetime,
      s.end_at AS "endAt",
      s.yield_active AS "yieldActive",
      s.base_price AS "basePrice",
      s.discount_price AS "discountPrice",
      s.appointment_id AS "appointmentId",
      u.name AS "professionalName"
    FROM "ScheduleSlot" s
    INNER JOIN "ProfessionalProfile" pp ON pp.id = s.professional_profile_id
    INNER JOIN "User" u ON u.id = pp.user_id
    WHERE s.id = ${slotId}
  `;

  if (!slot || slot.patientId !== patientId || slot.status !== "BOOKED") {
    return { success: false, error: "Reserva não encontrada." };
  }

  const basePrice = toMoneyNumber(slot.basePrice);
  const discountPrice =
    slot.discountPrice == null ? null : toMoneyNumber(slot.discountPrice);
  const confirmed = slot.holdExpiresAt == null;
  return {
    success: true,
    data: {
      slotId: slot.id,
      status: confirmed ? "confirmed" : "held",
      datetime: asDate(slot.datetime).toISOString(),
      endAt: asDate(slot.endAt).toISOString(),
      holdExpiresAt: slot.holdExpiresAt ? asDate(slot.holdExpiresAt).toISOString() : null,
      yieldActive: Boolean(slot.yieldActive),
      basePrice,
      discountPrice,
      effectivePrice:
        slot.yieldActive && discountPrice != null ? discountPrice : basePrice,
      professionalName: slot.professionalName?.trim() || "Profissional",
    },
  };
}

async function ensureAgendaAppointmentForHold(params: {
  slotId: string;
  marketplacePatientId: string;
}): Promise<void> {
  const slot = await prisma.scheduleSlot.findUnique({
    where: { id: params.slotId },
    select: {
      id: true,
      appointmentId: true,
      datetime: true,
      endAt: true,
      yieldActive: true,
      basePrice: true,
      discountPrice: true,
      professional: { select: { userId: true } },
    },
  });
  if (!slot || slot.appointmentId) return;

  const marketplacePatient = await prisma.patient.findUnique({
    where: { id: params.marketplacePatientId },
    select: { name: true, email: true, phone: true },
  });
  if (!marketplacePatient) return;

  const professionalUserId = slot.professional.userId;
  const email = marketplacePatient.email?.trim() || null;
  let chart = email
    ? await prisma.patient.findFirst({
        where: { userId: professionalUserId, email },
        select: { id: true },
      })
    : null;
  if (!chart) {
    chart = await prisma.patient.create({
      data: {
        userId: professionalUserId,
        name: marketplacePatient.name,
        email,
        phone: marketplacePatient.phone,
      },
      select: { id: true },
    });
  }

  const overlap = await findAppointmentOverlap(
    professionalUserId,
    slot.datetime,
    slot.endAt,
  );
  if (overlap.overlapping) {
    logger.warn("Reserva marketplace confirmada sem gravar na agenda (conflito)", {
      feature: "marketplace-confirm",
      slotId: slot.id,
      conflictingAppointmentId: overlap.conflictingAppointmentId,
    });
    return;
  }

  const effective =
    slot.yieldActive && slot.discountPrice != null
      ? toMoneyNumber(slot.discountPrice)
      : toMoneyNumber(slot.basePrice);

  const appointment = await prisma.appointment.create({
    data: {
      professionalUserId,
      patientId: chart.id,
      startAt: slot.datetime,
      endAt: slot.endAt,
      source: AppointmentSource.MANUAL,
      title: sanitizeText("Reserva pelo marketplace"),
      visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION,
      careSetting: AppointmentCareSetting.IN_PERSON_CLINIC,
      priceCents: Math.round(effective * 100),
    },
    select: { id: true },
  });

  await prisma.scheduleSlot.update({
    where: { id: slot.id },
    data: { appointmentId: appointment.id },
  });
  scheduleGoogleCalendarPush(professionalUserId, appointment.id);
}

export async function getMarketplaceReservation(
  raw: unknown,
): Promise<MarketplaceReservationView> {
  const parsed = bookScheduleSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }
  const authUser = await getAuthUser();
  if (!authUser) {
    return { success: false, error: "Faça login para ver a reserva." };
  }
  const patientId = await resolveMarketplacePatientId(authUser);
  await releaseExpiredMarketplaceHolds(prisma);
  return loadReservationView(parsed.data.slotId, patientId);
}

export async function confirmMarketplaceBooking(
  raw: unknown,
): Promise<MarketplaceReservationView> {
  const parsed = bookScheduleSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }
  const authUser = await getAuthUser();
  if (!authUser) {
    return { success: false, error: "Faça login para confirmar a reserva." };
  }

  const rl = await enforceRateLimit(
    await getMarketplaceRateLimitKey("marketplace-confirm", authUser.id),
    MARKETPLACE_BOOK_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Muitas tentativas. Tente em ${rl.resetIn}s.` };
  }

  const patientId = await resolveMarketplacePatientId(authUser);

  try {
    await prisma.$transaction(async (tx) => {
      await applyMarketplaceLockTimeouts(tx);
      await releaseExpiredMarketplaceHolds(tx);
      const updated = await tx.$executeRaw`
        UPDATE "ScheduleSlot"
        SET
          hold_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${parsed.data.slotId}
          AND status = 'BOOKED'
          AND patient_id = ${patientId}
          AND datetime > NOW()
      `;
      if (Number(updated) !== 1) {
        throw new BookingConflictError("Não foi possível confirmar esta reserva.");
      }
    });

    await ensureAgendaAppointmentForHold({
      slotId: parsed.data.slotId,
      marketplacePatientId: patientId,
    });
    return loadReservationView(parsed.data.slotId, patientId);
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { success: false, error: error.message };
    }
    logger.error("Falha ao confirmar reserva do marketplace", {
      feature: "marketplace-confirm",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível confirmar a reserva." };
  }
}

export async function releaseMarketplaceHold(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = bookScheduleSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }
  const authUser = await getAuthUser();
  if (!authUser) {
    return { success: false, error: "Faça login para liberar o horário." };
  }
  const patientId = await resolveMarketplacePatientId(authUser);

  try {
    const updated = await prisma.$executeRaw`
      UPDATE "ScheduleSlot"
      SET
        status = 'AVAILABLE',
        patient_id = NULL,
        hold_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${parsed.data.slotId}
        AND status = 'BOOKED'
        AND patient_id = ${patientId}
        AND hold_expires_at IS NOT NULL
    `;
    if (Number(updated) !== 1) {
      return { success: false, error: "Esta reserva já não pode ser cancelada." };
    }
    return { success: true };
  } catch (error) {
    logger.error("Falha ao liberar hold do marketplace", {
      feature: "marketplace-release",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível liberar o horário." };
  }
}

class BookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingConflictError";
  }
}

/**
 * Marca na hora um horário publicado na vitrine.
 * Desconto (yield) vale para quem o profissional ofertou.
 * Horário comum só entra se ele liberou a agenda.
 * A confirmação grava a consulta na agenda do profissional.
 */
export async function bookPublishedShowcaseSlot(
  raw: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = bookScheduleSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }
  const authUser = await getAuthUser();
  if (!authUser) {
    return { success: false, error: "Faça login para marcar o horário." };
  }

  const slot = await prisma.scheduleSlot.findUnique({
    where: { id: parsed.data.slotId },
    select: {
      yieldActive: true,
      manualOffer: true,
      professional: {
        select: {
          showcaseApproved: true,
          allowPatientAgendaBooking: true,
          user: { select: { isBlocked: true, profession: true } },
        },
      },
    },
  });
  if (
    !slot ||
    !slot.manualOffer ||
    !slot.professional.showcaseApproved ||
    slot.professional.user.isBlocked ||
    !isShowcaseEligibleProfession(slot.professional.user.profession)
  ) {
    return { success: false, error: "Este horário não está disponível." };
  }
  if (!slot.yieldActive && !slot.professional.allowPatientAgendaBooking) {
    return {
      success: false,
      error: "Este profissional ainda não liberou a agenda. Envie uma mensagem para combinar.",
    };
  }

  const held = await bookScheduleSlot(parsed.data);
  if (!held.success) return held;
  const confirmed = await confirmMarketplaceBooking(parsed.data);
  if (!confirmed.success) return confirmed;
  return { success: true };
}
