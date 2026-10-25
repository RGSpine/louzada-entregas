import "server-only";

import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePlanTier, type PlanTier } from "@/lib/plan-tier";
import {
  DEFAULT_INTRA_USER_COLOR,
  INTRA_USER_COOKIE,
  maxIntraUsersForPlan,
  planSupportsIntraUsers,
} from "@/lib/intra-user/constants";
import type { ActiveIntraUser } from "@/lib/intra-user/patient-scope";

export interface Tenant {
  id: string;
  name: string | null;
  email: string | null;
  tier: PlanTier | null;
  teamSetupCompleted: boolean;
}

export interface IntraUserContext {
  tenantId: string;
  tenantName: string | null;
  tier: PlanTier | null;
  /** Plano de equipe (Consultório/Clínica) com seletor de perfil. */
  isClinica: boolean;
  maxIntraUsers: number;
  intraUserCount: number;
  /** Todos os perfis do Tenant (para o seletor). */
  profiles: ActiveIntraUser[];
  /** Perfil ativo resolvido (cookie ou único perfil). Null se ainda precisa selecionar. */
  activeIntraUser: ActiveIntraUser | null;
  /** True quando há múltiplos perfis e nenhum selecionado (força tela de seleção). */
  requiresProfileSelection: boolean;
  /** False só no primeiro acesso, até cadastrar os operadores da conta. */
  teamSetupCompleted: boolean;
}

function toActive(row: {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  pinHash?: string | null;
  canManagePatientServices?: boolean;
}): ActiveIntraUser {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    isOwner: row.isOwner,
    hasPin: row.role === "ADMIN" && Boolean(row.pinHash),
    canManagePatientServices:
      row.role === "ADMIN" ? true : row.canManagePatientServices !== false,
  };
}

/** Resolve o Tenant (User pagante) da sessão Supabase atual. */
export async function resolveTenant(): Promise<Tenant | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) return null;

  const dbUser = await prisma.user.findFirst({
    where: { OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }] },
    select: { id: true, name: true, email: true, plan: true, teamSetupCompletedAt: true },
  });
  if (!dbUser) return null;

  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    tier: normalizePlanTier(dbUser.plan),
    teamSetupCompleted: dbUser.teamSetupCompletedAt != null,
  };
}

/**
 * Garante que o Tenant tem um Intra User dono (ADMIN). Cria de forma lazy para
 * contas criadas antes da migração de backfill ou novos cadastros.
 *
 * Race-safe: índice único parcial (um owner por tenant) + re-fetch em P2002.
 */
export async function ensureOwnerIntraUser(
  tenantId: string,
  fallbackName?: string | null,
): Promise<ActiveIntraUser> {
  const existing = await prisma.intraUser.findFirst({
    where: { userId: tenantId, isOwner: true },
  });
  if (existing) return toActive(existing);

  try {
    const created = await prisma.intraUser.create({
      data: {
        userId: tenantId,
        name: (fallbackName ?? "").trim() || "Titular",
        color: DEFAULT_INTRA_USER_COLOR,
        role: "ADMIN",
        isOwner: true,
      },
    });
    return toActive(created);
  } catch (err) {
    // Só recupera race de unique constraint (outro request criou o dono em paralelo).
    // Outros erros (rede, validação, etc.) devem propagar sem mascarar.
    const isUniqueViolation =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!isUniqueViolation) throw err;

    const raced = await prisma.intraUser.findFirst({
      where: { userId: tenantId, isOwner: true },
    });
    if (raced) return toActive(raced);
    throw err;
  }
}

/**
 * Contexto completo de Intra User para a sessão atual (Tenant + perfil ativo).
 * Retorna null se não autenticado.
 */
export async function getIntraUserContext(): Promise<IntraUserContext | null> {
  const tenant = await resolveTenant();
  if (!tenant) return null;

  const rows = await prisma.intraUser.findMany({
    where: { userId: tenant.id },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
  });

  // Bootstrap lazy do dono se ainda não existir nenhum perfil.
  let profiles = rows;
  if (profiles.length === 0) {
    await ensureOwnerIntraUser(tenant.id, tenant.name);
    // Re-query garante timestamps e campos idênticos ao que o banco retorna.
    profiles = await prisma.intraUser.findMany({
      where: { userId: tenant.id },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
    });
  }

  const isClinica = tenant.tier ? planSupportsIntraUsers(tenant.tier) : false;
  const cookieStore = await cookies();
  const cookieId = cookieStore.get(INTRA_USER_COOKIE)?.value ?? null;
  const operators = profiles.filter((row) => !row.isMotoboy);
  const roster = operators.length > 0 ? operators : profiles;

  let active: ActiveIntraUser | null = null;
  if (cookieId) {
    const match = roster.find((p) => p.id === cookieId);
    if (match) active = toActive(match);
  }

  // Um operador só (o titular) entra direto. Entregador não é perfil de operação:
  // a coleta, o cliente e o caixa são da conta, visíveis para quem estiver logado.
  // Com 2+ operadores e sem cookie → pede o nome, sem separar os dados.
  if (!active && roster.length === 1) {
    active = toActive(roster[0]!);
  } else if (!active && !isClinica && roster.length >= 1) {
    active = toActive(roster[0]!);
  }

  const requiresProfileSelection =
    isClinica && roster.length > 1 && !active;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tier: tenant.tier,
    isClinica,
    maxIntraUsers: tenant.tier ? maxIntraUsersForPlan(tenant.tier) : 1,
    intraUserCount: roster.length,
    profiles: roster.map(toActive),
    activeIntraUser: active,
    requiresProfileSelection,
    teamSetupCompleted: tenant.teamSetupCompleted,
  };
}
