"use server";

import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { firstZodError } from "@/lib/marketplace/schemas";
import { syncProfessionalMarketplace } from "@/lib/marketplace/marketplace-sync";
import { computeDiscountPrice } from "@/lib/marketplace/yield-apply";
import { centsToReais, MARKETPLACE_SLOT_MINUTES } from "@/lib/marketplace/slot-grid";
import {
  findAppointmentOverlap,
} from "@/lib/appointment-availability";
import {
  findMarketplaceBookedOverlap,
  withAgendaYieldTransaction,
} from "@/lib/marketplace/native-agenda-lock";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import {
  canUseYieldManagement,
  YIELD_MANAGEMENT_PLAN_ERROR,
} from "@/lib/plan-limits";
import {
  DEFAULT_YIELD_CONFIG,
  offerAgendaSlotSchema,
  withdrawAgendaSlotSchema,
  yieldConfigSchema,
  yieldOfferWindowSchema,
  type YieldConfigData,
  type YieldDashboardData,
  type YieldMarketplaceSlotRow,
  type YieldOfferWindowData,
} from "@/lib/marketplace/yield-schema";

export type YieldConfigResult =
  | { success: true; data: YieldConfigData }
  | { success: false; error: string; code?: "PLAN_REQUIRED" };

export type YieldDashboardResult =
  | { success: true; data: YieldDashboardData }
  | { success: false; error: string; code?: "PLAN_REQUIRED" };

export type YieldActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: "PLAN_REQUIRED" };

const YIELD_CONFIG_RATE_LIMIT = { maxRequests: 30, windowSeconds: 60 };

async function getAuthenticatedProfessional(): Promise<{
  id: string;
  allowed: boolean;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) return null;

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true, isBlocked: true, plan: true, email: true, isInfluencer: true },
  });

  if (!dbUser || dbUser.isBlocked) return null;
  return {
    id: dbUser.id,
    allowed: canUseYieldManagement(dbUser.plan, dbUser.email, dbUser.isInfluencer),
  };
}

function toYieldConfig(
  enabled: boolean,
  rule: { id: string; hoursBeforeTrigger: number; discountPercentage: Prisma.Decimal } | null,
): YieldConfigData {
  return {
    enabled,
    hoursBeforeTrigger: rule?.hoursBeforeTrigger ?? DEFAULT_YIELD_CONFIG.hoursBeforeTrigger,
    discountPercentage: rule
      ? Number(rule.discountPercentage)
      : DEFAULT_YIELD_CONFIG.discountPercentage,
    ruleId: rule?.id ?? null,
  };
}

function toWindowData(row: {
  id: string;
  label: string | null;
  recurrence: "WEEKLY" | "ONCE";
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  specificDate: Date | null;
  isActive: boolean;
}): YieldOfferWindowData {
  return {
    id: row.id,
    label: row.label,
    recurrence: row.recurrence,
    weekdays: row.weekdays,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    specificDate: row.specificDate
      ? DateTime.fromJSDate(row.specificDate, { zone: "utc" }).toFormat("yyyy-LL-dd")
      : null,
    isActive: row.isActive,
  };
}

async function ensureDefaultWeeklyWindow(
  tx: Prisma.TransactionClient,
  profileId: string,
): Promise<void> {
  const count = await tx.yieldOfferWindow.count({
    where: { professionalProfileId: profileId },
  });
  if (count > 0) return;
  await tx.yieldOfferWindow.create({
    data: {
      professionalProfileId: profileId,
      label: "Horário comercial",
      recurrence: "WEEKLY",
      weekdays: [1, 2, 3, 4, 5, 6],
      startMinute: 8 * 60,
      endMinute: 18 * 60,
      isActive: true,
    },
  });
}

export async function getYieldConfig(): Promise<YieldConfigResult> {
  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  try {
    const profile = await prisma.professionalProfile.findUnique({
      where: { userId: professional.id },
      select: {
        yieldManagementEnabled: true,
        yieldRules: {
          where: { isActive: true },
          orderBy: { hoursBeforeTrigger: "asc" },
          take: 1,
          select: {
            id: true,
            hoursBeforeTrigger: true,
            discountPercentage: true,
          },
        },
      },
    });

    if (!profile) {
      return { success: true, data: DEFAULT_YIELD_CONFIG };
    }

    return {
      success: true,
      data: toYieldConfig(profile.yieldManagementEnabled, profile.yieldRules[0] ?? null),
    };
  } catch (error) {
    logger.error("Falha ao ler configuração de yield", {
      feature: "yield-config",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: true, data: DEFAULT_YIELD_CONFIG };
  }
}

export async function getYieldDashboard(): Promise<YieldDashboardResult> {
  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  try {
    // Limpa ofertas automáticas legadas ao abrir o painel (não pode derrubar a leitura).
    try {
      await syncProfessionalMarketplace(professional.id);
    } catch (syncError) {
      logger.warn("Sync marketplace falhou ao abrir dashboard de yield", {
        feature: "yield-config",
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    const profile = await prisma.professionalProfile.findUnique({
      where: { userId: professional.id },
      select: {
        id: true,
        yieldManagementEnabled: true,
        yieldRules: {
          where: { isActive: true },
          orderBy: { hoursBeforeTrigger: "asc" },
          take: 1,
          select: {
            id: true,
            hoursBeforeTrigger: true,
            discountPercentage: true,
          },
        },
        offerWindows: {
          where: { isActive: true },
          orderBy: [{ recurrence: "asc" }, { startMinute: "asc" }],
          select: {
            id: true,
            label: true,
            recurrence: true,
            weekdays: true,
            startMinute: true,
            endMinute: true,
            specificDate: true,
            isActive: true,
          },
        },
      },
    });

    const config = toYieldConfig(
      profile?.yieldManagementEnabled ?? false,
      profile?.yieldRules[0] ?? null,
    );

    const windows = (profile?.offerWindows ?? []).map(toWindowData);

    const now = new Date();
    const slotsRaw = profile
      ? await prisma.scheduleSlot.findMany({
          where: {
            professionalProfileId: profile.id,
            datetime: { gte: now },
            OR: [
              { manualOffer: true, status: { in: ["AVAILABLE", "BOOKED"] } },
              { status: "BOOKED" },
            ],
          },
          orderBy: { datetime: "asc" },
          take: 80,
          select: {
            id: true,
            datetime: true,
            endAt: true,
            status: true,
            yieldActive: true,
            manualOffer: true,
            basePrice: true,
            discountPrice: true,
            patient: { select: { name: true } },
          },
        })
      : [];

    const slots: YieldMarketplaceSlotRow[] = slotsRaw.map((slot) => ({
      id: slot.id,
      startAt: slot.datetime.toISOString(),
      endAt: slot.endAt.toISOString(),
      status: slot.status,
      yieldActive: slot.yieldActive,
      manualOffer: slot.manualOffer,
      basePrice: Number(slot.basePrice),
      discountPrice: slot.discountPrice != null ? Number(slot.discountPrice) : null,
      patientName: slot.patient?.name ?? null,
    }));

    return { success: true, data: { config, windows, slots } };
  } catch (error) {
    logger.error("Falha ao ler dashboard de yield", {
      feature: "yield-config",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: true,
      data: { config: DEFAULT_YIELD_CONFIG, windows: [], slots: [] },
    };
  }
}

export async function saveYieldConfig(raw: unknown): Promise<YieldConfigResult> {
  const parsed = yieldConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  const rl = await enforceRateLimit(`yield-config:${professional.id}`, YIELD_CONFIG_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Muitas alterações. Tente em ${rl.resetIn}s.` };
  }

  const { enabled, hoursBeforeTrigger, discountPercentage } = parsed.data;

  try {
    const data = await prisma.$transaction(async (tx) => {
      const profile = await tx.professionalProfile.upsert({
        where: { userId: professional.id },
        create: {
          userId: professional.id,
          yieldManagementEnabled: enabled,
        },
        update: {
          yieldManagementEnabled: enabled,
        },
        select: { id: true },
      });

      if (enabled) {
        await ensureDefaultWeeklyWindow(tx, profile.id);
      }

      const existing = await tx.yieldRule.findFirst({
        where: { professionalProfileId: profile.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });

      const rule = existing
        ? await tx.yieldRule.update({
            where: { id: existing.id },
            data: {
              hoursBeforeTrigger,
              discountPercentage,
              isActive: enabled,
            },
            select: {
              id: true,
              hoursBeforeTrigger: true,
              discountPercentage: true,
            },
          })
        : await tx.yieldRule.create({
            data: {
              professionalProfileId: profile.id,
              hoursBeforeTrigger,
              discountPercentage,
              isActive: enabled,
            },
            select: {
              id: true,
              hoursBeforeTrigger: true,
              discountPercentage: true,
            },
          });

      return toYieldConfig(enabled, rule);
    });

    await syncProfessionalMarketplace(professional.id);
    return { success: true, data };
  } catch (error) {
    logger.error("Falha ao salvar configuração de yield", {
      feature: "yield-config",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: "Não foi possível salvar a Gestão Inteligente agora.",
    };
  }
}

export async function saveYieldOfferWindow(
  raw: unknown,
): Promise<YieldActionResult<YieldOfferWindowData>> {
  const parsed = yieldOfferWindowSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  const rl = await enforceRateLimit(`yield-window:${professional.id}`, YIELD_CONFIG_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Muitas alterações. Tente em ${rl.resetIn}s.` };
  }

  const input = parsed.data;

  try {
    const profile = await prisma.professionalProfile.upsert({
      where: { userId: professional.id },
      create: { userId: professional.id },
      update: {},
      select: { id: true },
    });

    const data = {
      label: input.label?.trim() || null,
      recurrence: input.recurrence,
      weekdays: input.recurrence === "WEEKLY" ? [...new Set(input.weekdays)].sort() : [],
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      specificDate:
        input.recurrence === "ONCE" && input.specificDate
          ? DateTime.fromISO(input.specificDate, { zone: "utc" }).toJSDate()
          : null,
      isActive: input.isActive ?? true,
    };

    const row = input.id
      ? await prisma.yieldOfferWindow.updateMany({
          where: { id: input.id, professionalProfileId: profile.id },
          data,
        }).then(async (res) => {
          if (res.count === 0) return null;
          return prisma.yieldOfferWindow.findFirst({
            where: { id: input.id, professionalProfileId: profile.id },
          });
        })
      : await prisma.yieldOfferWindow.create({
          data: { professionalProfileId: profile.id, ...data },
        });

    if (!row) {
      return { success: false, error: "Janela não encontrada." };
    }

    await syncProfessionalMarketplace(professional.id);
    return { success: true, data: toWindowData(row) };
  } catch (error) {
    logger.error("Falha ao salvar janela de yield", {
      feature: "yield-config",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível salvar a janela de horários." };
  }
}

export async function deleteYieldOfferWindow(
  raw: unknown,
): Promise<YieldActionResult<{ id: string }>> {
  const id =
    typeof raw === "object" && raw && "id" in raw && typeof (raw as { id: unknown }).id === "string"
      ? (raw as { id: string }).id.trim()
      : "";
  if (!id) {
    return { success: false, error: "Informe a janela." };
  }

  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: { id: true },
  });
  if (!profile) {
    return { success: false, error: "Perfil não encontrado." };
  }

  const result = await prisma.yieldOfferWindow.updateMany({
    where: { id, professionalProfileId: profile.id },
    data: { isActive: false },
  });
  if (result.count === 0) {
    return { success: false, error: "Janela não encontrada." };
  }

  await syncProfessionalMarketplace(professional.id);
  return { success: true, data: { id } };
}

/**
 * Agenda nativa → marketplace: cria/atualiza slot AVAILABLE com desconto imediato.
 */
export async function offerAgendaSlotForYield(
  raw: unknown,
): Promise<YieldActionResult<{ slotId: string }>> {
  const parsed = offerAgendaSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  const startAt = parsed.data.startAt;
  const endAt =
    parsed.data.endAt ??
    new Date(startAt.getTime() + MARKETPLACE_SLOT_MINUTES * 60_000);

  if (endAt.getTime() <= startAt.getTime()) {
    return { success: false, error: "O término deve ser depois do início." };
  }

  try {
    const slotId = await withAgendaYieldTransaction(async (tx) => {
      const profile = await tx.professionalProfile.upsert({
        where: { userId: professional.id },
        create: {
          userId: professional.id,
          yieldManagementEnabled: true,
        },
        update: {
          yieldManagementEnabled: true,
        },
        select: { id: true },
      });

      await ensureDefaultWeeklyWindow(tx, profile.id);

      const market = await findMarketplaceBookedOverlap(
        tx,
        professional.id,
        startAt,
        endAt,
      );
      if (market.overlapping) {
        throw new Error("Este horário já está reservado por um paciente no marketplace.");
      }

      const busy = await findAppointmentOverlap(professional.id, startAt, endAt, {
        client: tx,
      });
      if (busy.overlapping) {
        throw new Error("Já existe atendimento interno neste horário.");
      }

      const service = await tx.professionalService.findFirst({
        where: { userId: professional.id, active: true },
        orderBy: { updatedAt: "desc" },
        select: { defaultPriceCents: true },
      });
      const basePrice = centsToReais(service?.defaultPriceCents);

      let rule = await tx.yieldRule.findFirst({
        where: { professionalProfileId: profile.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true, discountPercentage: true, isActive: true },
      });

      const discountPct =
        parsed.data.discountPercentage ??
        (rule ? Number(rule.discountPercentage) : DEFAULT_YIELD_CONFIG.discountPercentage);

      if (!rule) {
        rule = await tx.yieldRule.create({
          data: {
            professionalProfileId: profile.id,
            hoursBeforeTrigger: DEFAULT_YIELD_CONFIG.hoursBeforeTrigger,
            discountPercentage: discountPct,
            isActive: true,
          },
          select: { id: true, discountPercentage: true, isActive: true },
        });
      } else if (!rule.isActive) {
        rule = await tx.yieldRule.update({
          where: { id: rule.id },
          data: { isActive: true },
          select: { id: true, discountPercentage: true, isActive: true },
        });
      }

      const discountPrice = computeDiscountPrice(basePrice, discountPct);
      const existing = await tx.scheduleSlot.findFirst({
        where: {
          professionalProfileId: profile.id,
          datetime: startAt,
        },
        select: { id: true, status: true },
      });

      if (existing?.status === "BOOKED") {
        throw new Error("Este horário já está reservado no marketplace.");
      }

      if (existing) {
        await tx.scheduleSlot.update({
          where: { id: existing.id },
          data: {
            status: "AVAILABLE",
            endAt,
            manualOffer: true,
            yieldActive: true,
            discountPrice,
            yieldRuleId: rule.id,
            appointmentId: null,
            patientId: null,
            holdExpiresAt: null,
            basePrice,
          },
        });
        return existing.id;
      }

      const created = await tx.scheduleSlot.create({
        data: {
          professionalProfileId: profile.id,
          datetime: startAt,
          endAt,
          status: "AVAILABLE",
          basePrice,
          manualOffer: true,
          yieldActive: true,
          discountPrice,
          yieldRuleId: rule.id,
        },
        select: { id: true },
      });
      return created.id;
    });

    return { success: true, data: { slotId } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Não foi possível ofertar o horário.",
    };
  }
}

export async function withdrawMarketplaceSlot(
  raw: unknown,
): Promise<YieldActionResult<{ id: string }>> {
  const parsed = withdrawAgendaSlotSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error) };
  }

  const professional = await getAuthenticatedProfessional();
  if (!professional) {
    return { success: false, error: "Não autenticado." };
  }
  if (!professional.allowed) {
    return { success: false, error: YIELD_MANAGEMENT_PLAN_ERROR, code: "PLAN_REQUIRED" };
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: professional.id },
    select: { id: true },
  });
  if (!profile) {
    return { success: false, error: "Perfil não encontrado." };
  }

  const slot = await prisma.scheduleSlot.findFirst({
    where: {
      id: parsed.data.slotId,
      professionalProfileId: profile.id,
    },
    select: { id: true, status: true },
  });
  if (!slot) {
    return { success: false, error: "Horário não encontrado." };
  }
  if (slot.status === "BOOKED") {
    return {
      success: false,
      error: "Não é possível retirar um horário já reservado pelo paciente.",
    };
  }

  await prisma.scheduleSlot.delete({ where: { id: slot.id } });
  return { success: true, data: { id: slot.id } };
}
