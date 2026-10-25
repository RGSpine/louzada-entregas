"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { requireOfficeFinanceUser } from "@/lib/office-finance-access";
import { requireFinanceAdmin, getFinanceAccessRole } from "@/lib/finance/finance-rbac";
import {
  assertValidServiceSpaceColor,
  canUseServiceSpaces,
  DEFAULT_SERVICE_SPACE_COLOR,
  maxServiceSpacesForPlan,
  SERVICE_SPACES_PLAN_ERROR,
} from "@/lib/service-spaces/access";
import { normalizePlanTier } from "@/lib/plan-tier";
import { PROFILE_REQUIRED_ERROR } from "@/lib/intra-user/patient-access";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function requireServiceSpacesTenant(): Promise<
  | { ok: true; userId: string; plan: string | null; isInfluencer: boolean }
  | { ok: false; error: string }
> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) return { ok: false, error: access.error };

  const user = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { plan: true, isInfluencer: true, email: true },
  });
  if (!user) return { ok: false, error: "Usuário não encontrado." };
  if (!canUseServiceSpaces(user.plan, user.email, user.isInfluencer)) {
    return { ok: false, error: SERVICE_SPACES_PLAN_ERROR };
  }
  return {
    ok: true,
    userId: access.userId,
    plan: user.plan,
    isInfluencer: user.isInfluencer,
  };
}

export type ServiceSpaceRow = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sortOrder: number;
};

export async function listServiceSpaces(input?: {
  includeInactive?: boolean;
}): Promise<ActionResult<{ enabled: boolean; spaces: ServiceSpaceRow[] }>> {
  const access = await requireOfficeFinanceUser();
  if (!access.ok) return { success: false, error: access.error };

  const user = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { plan: true, isInfluencer: true, email: true },
  });
  if (!user) return { success: false, error: "Usuário não encontrado." };

  const enabled = canUseServiceSpaces(user.plan, user.email, user.isInfluencer);
  if (!enabled) {
    return { success: true, data: { enabled: false, spaces: [] } };
  }

  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const spaces = await prisma.serviceSpace.findMany({
    where: {
      userId: access.userId,
      ...(input?.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      active: true,
      sortOrder: true,
    },
  });

  return { success: true, data: { enabled: true, spaces } };
}

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80),
  color: z.string().trim().min(7).max(7).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export async function upsertServiceSpace(
  input: unknown,
): Promise<ActionResult<ServiceSpaceRow>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const tenant = await requireServiceSpacesTenant();
  if (!tenant.ok) return { success: false, error: tenant.error };

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" ") || "Dados inválidos.",
    };
  }

  const name = sanitizeText(parsed.data.name);
  const color =
    assertValidServiceSpaceColor(parsed.data.color ?? DEFAULT_SERVICE_SPACE_COLOR) ??
    DEFAULT_SERVICE_SPACE_COLOR;

  const tier = normalizePlanTier(tenant.plan);
  const max = maxServiceSpacesForPlan(tier);

  if (parsed.data.id) {
    const existing = await prisma.serviceSpace.findFirst({
      where: { id: parsed.data.id, userId: tenant.userId },
      select: { id: true, active: true },
    });
    if (!existing) return { success: false, error: "Espaço não encontrado." };

    const willActivate = parsed.data.active === true && !existing.active;
    if (willActivate) {
      const activeCount = await prisma.serviceSpace.count({
        where: { userId: tenant.userId, active: true },
      });
      if (activeCount >= max) {
        return {
          success: false,
          error: `Limite de ${max} espaços activos neste plano. Desactive um espaço ou faça upgrade.`,
        };
      }
    }

    const row = await prisma.serviceSpace.update({
      where: { id: existing.id },
      data: {
        name,
        color,
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.sortOrder !== undefined
          ? { sortOrder: parsed.data.sortOrder }
          : {}),
      },
      select: {
        id: true,
        name: true,
        color: true,
        active: true,
        sortOrder: true,
      },
    });
    revalidatePath("/dashboard/finances");
    revalidatePath("/dashboard/agenda");
    return { success: true, data: row };
  }

  const activeCount = await prisma.serviceSpace.count({
    where: { userId: tenant.userId, active: true },
  });
  if (activeCount >= max) {
    return {
      success: false,
      error: `Limite de ${max} espaços activos neste plano. Desactive um espaço ou faça upgrade.`,
    };
  }

  const row = await prisma.serviceSpace.create({
    data: {
      userId: tenant.userId,
      name,
      color,
      sortOrder: parsed.data.sortOrder ?? activeCount,
      active: parsed.data.active ?? true,
    },
    select: {
      id: true,
      name: true,
      color: true,
      active: true,
      sortOrder: true,
    },
  });

  revalidatePath("/dashboard/finances");
  revalidatePath("/dashboard/agenda");
  return { success: true, data: row };
}

/**
 * Soft-deactivate. Não apaga histórico financeiro/agenda.
 */
export async function deactivateServiceSpace(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const tenant = await requireServiceSpacesTenant();
  if (!tenant.ok) return { success: false, error: tenant.error };

  const parsed = z.object({ id: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { success: false, error: "ID inválido." };

  const existing = await prisma.serviceSpace.findFirst({
    where: { id: parsed.data.id, userId: tenant.userId },
    select: { id: true },
  });
  if (!existing) return { success: false, error: "Espaço não encontrado." };

  await prisma.serviceSpace.update({
    where: { id: existing.id },
    data: { active: false },
  });

  revalidatePath("/dashboard/finances");
  revalidatePath("/dashboard/agenda");
  return { success: true, data: { id: existing.id } };
}

/** Valida plano + posse do espaço. Por omissão exige activo. */
export async function assertServiceSpaceOwned(
  spaceId: string | null | undefined,
  userId: string,
  opts?: { allowInactive?: boolean },
): Promise<{ ok: true; spaceId: string | null } | { ok: false; error: string }> {
  if (!spaceId) return { ok: true, spaceId: null };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, isInfluencer: true, email: true },
  });
  if (!user || !canUseServiceSpaces(user.plan, user.email, user.isInfluencer)) {
    return { ok: false, error: SERVICE_SPACES_PLAN_ERROR };
  }

  const row = await prisma.serviceSpace.findFirst({
    where: {
      id: spaceId,
      userId,
      ...(opts?.allowInactive ? {} : { active: true }),
    },
    select: { id: true },
  });
  if (!row) {
    return {
      ok: false,
      error: opts?.allowInactive
        ? "Espaço de Serviços inválido."
        : "Espaço de Serviços inválido ou inactivo.",
    };
  }
  return { ok: true, spaceId: row.id };
}
