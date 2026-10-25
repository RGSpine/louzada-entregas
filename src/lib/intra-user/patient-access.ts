import "server-only";

import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  ensureOwnerIntraUser,
  getIntraUserContext,
  type IntraUserContext,
} from "@/lib/intra-user/context";
import {
  INTRA_USER_COOKIE,
  planSupportsIntraUsers,
} from "@/lib/intra-user/constants";
import {
  buildPatientScopeWhere,
  EMPTY_PATIENT_SCOPE,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";
import { normalizePlanTier } from "@/lib/plan-tier";
import { verifyAdminPin } from "@/lib/intra-user/pin";
import {
  enforceRateLimit,
  INTRA_USER_PIN_RATE_LIMIT,
} from "@/lib/rate-limit";

export interface PatientAccessScope {
  tenantId: string;
  activeIntraUser: ActiveIntraUser | null;
  /** True quando o plano exige seleção de perfil e nenhum está ativo. */
  denied: boolean;
}

const PROFILE_REQUIRED_ERROR = "Selecione o perfil profissional para continuar.";

function toActiveFromRow(match: {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  pinHash?: string | null;
  canManagePatientServices?: boolean;
}): ActiveIntraUser {
  return {
    id: match.id,
    name: match.name,
    color: match.color,
    role: match.role,
    isOwner: match.isOwner,
    hasPin: match.role === "ADMIN" && Boolean(match.pinHash),
    canManagePatientServices:
      match.role === "ADMIN" ? true : match.canManagePatientServices !== false,
  };
}

/**
 * Exige Tenant autenticado + perfil Intra User ativo.
 * Em planos de equipe com 2+ perfis e cookie ausente/inválido → erro (fail-closed).
 */
export async function requireActiveIntraUser(): Promise<
  | { ok: true; ctx: IntraUserContext; activeIntraUser: ActiveIntraUser }
  | { ok: false; error: string }
> {
  const ctx = await getIntraUserContext();
  if (!ctx) return { ok: false, error: "Não autenticado." };
  if (ctx.requiresProfileSelection || !ctx.activeIntraUser) {
    return { ok: false, error: PROFILE_REQUIRED_ERROR };
  }
  return { ok: true, ctx, activeIntraUser: ctx.activeIntraUser };
}

/** Escopo de pacientes (Tenant + perfil ativo) para a sessão atual, ou null se não autenticado. */
export async function getPatientAccessScope(): Promise<PatientAccessScope | null> {
  const ctx = await getIntraUserContext();
  if (!ctx) return null;
  if (ctx.requiresProfileSelection || !ctx.activeIntraUser) {
    return {
      tenantId: ctx.tenantId,
      activeIntraUser: null,
      denied: true,
    };
  }
  return {
    tenantId: ctx.tenantId,
    activeIntraUser: ctx.activeIntraUser,
    denied: false,
  };
}

/**
 * Filtro Prisma de pacientes. Se perfil pendente → escopo vazio (fail-closed).
 * null apenas quando não autenticado.
 */
export async function getPatientScopeWhere(): Promise<Prisma.PatientWhereInput | null> {
  const scope = await getPatientAccessScope();
  if (!scope) return null;
  if (scope.denied) {
    return { userId: scope.tenantId, ...EMPTY_PATIENT_SCOPE };
  }
  return buildPatientScopeWhere(scope);
}

/**
 * Verifica se o perfil ativo pode acessar o paciente (owner, compartilhado ou ADMIN).
 * Sem perfil / perfil pendente → ok: false.
 */
export async function assertPatientAccessible(
  patientId: string,
): Promise<{ ok: boolean; scope: PatientAccessScope | null; error?: string }> {
  const scope = await getPatientAccessScope();
  if (!scope) return { ok: false, scope: null, error: "Não autenticado." };
  if (scope.denied || !scope.activeIntraUser) {
    return { ok: false, scope, error: PROFILE_REQUIRED_ERROR };
  }
  const where = buildPatientScopeWhere(scope);
  const row = await prisma.patient.findFirst({
    where: { ...where, id: patientId },
    select: { id: true },
  });
  if (!row) {
    return { ok: false, scope, error: "Paciente não encontrado ou sem permissão." };
  }
  return { ok: true, scope };
}

/**
 * Assert com escopo explícito (útil em services que já receberam o Intra User).
 */
export async function assertPatientAccessibleWithScope(
  patientId: string,
  tenantId: string,
  activeIntraUser: ActiveIntraUser | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!activeIntraUser) {
    return { ok: false, error: PROFILE_REQUIRED_ERROR };
  }
  const where = buildPatientScopeWhere({ tenantId, activeIntraUser });
  const row = await prisma.patient.findFirst({
    where: { ...where, id: patientId },
    select: { id: true },
  });
  if (!row) {
    return { ok: false, error: "Paciente não encontrado ou sem permissão." };
  }
  return { ok: true };
}

/** Intra User que deve possuir um paciente recém-criado (o perfil ativo). */
export function ownerIdForNewPatient(scope: PatientAccessScope | null): string | null {
  if (!scope || scope.denied) return null;
  return scope.activeIntraUser?.id ?? null;
}

/**
 * Resolve Intra User ativo a partir de cookie ou header `x-intra-user-id`
 * (API v1 / mobile). Valida que o id pertence ao tenant.
 *
 * Em planos de equipe com 2+ perfis e sem id válido → null (caller deve 403).
 * Em plano individual / 1 perfil → auto-seleciona o único/dono.
 */
export async function resolveIntraUserForApiRequest(
  tenantId: string,
  plan: string | null | undefined,
  request: NextRequest,
): Promise<{
  activeIntraUser: ActiveIntraUser | null;
  requiresProfile: boolean;
}> {
  const tier = normalizePlanTier(plan);
  const isClinica = tier ? planSupportsIntraUsers(tier) : false;

  const profiles = await prisma.intraUser.findMany({
    where: { userId: tenantId },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
  });

  // Bootstrap lazy do dono se a migração ainda não criou Intra Users.
  let rows = profiles;
  if (rows.length === 0) {
    await ensureOwnerIntraUser(tenantId, "Titular");
    rows = await prisma.intraUser.findMany({
      where: { userId: tenantId },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
    });
  }

  const headerId = request.headers.get("x-intra-user-id")?.trim() || null;
  const cookieId = request.cookies.get(INTRA_USER_COOKIE)?.value?.trim() || null;
  const requestedId = headerId || cookieId;

  if (requestedId) {
    const match = rows.find((p) => p.id === requestedId);
    if (match) {
      const active = toActiveFromRow(match);

      // Cookie = sessão já desbloqueada (web após PIN). MEMBER ou cookie ADMIN ok.
      if (cookieId === match.id) {
        return { activeIntraUser: active, requiresProfile: false };
      }

      // Header sozinho reivindicando ADMIN: exige X-Intra-User-Pin (Opção B).
      if (match.role === "ADMIN") {
        if (!match.pinHash) {
          return { activeIntraUser: null, requiresProfile: true };
        }
        const pin = request.headers.get("x-intra-user-pin")?.trim() ?? "";
        const rl = await enforceRateLimit(
          `intra-pin:${tenantId}:${match.id}`,
          INTRA_USER_PIN_RATE_LIMIT,
        );
        if (!rl.allowed) {
          return { activeIntraUser: null, requiresProfile: true };
        }
        const ok = await verifyAdminPin(pin, match.pinHash);
        if (!ok) {
          return { activeIntraUser: null, requiresProfile: true };
        }
      }

      return { activeIntraUser: active, requiresProfile: false };
    }
  }

  if (!isClinica || rows.length === 1) {
    // Individual: auto. Equipe com 1 perfil via API: auto (mobile/header).
    // Web exige cookie (tela de seleção) via getIntraUserContext.
    const only = rows[0]!;
    return {
      activeIntraUser: toActiveFromRow(only),
      requiresProfile: false,
    };
  }

  return { activeIntraUser: null, requiresProfile: true };
}

/**
 * Resolve perfil Intra User para rotas API v1 (cookie ou header `x-intra-user-id`).
 * ADMIN via header exige também `X-Intra-User-Pin` se o PIN estiver configurado.
 * Em clínica com 2+ perfis sem id válido → 403.
 */
export async function requireApiV1IntraUser(
  request: NextRequest,
  tenantId: string,
  plan: string | null | undefined,
): Promise<
  | { ok: true; activeIntraUser: ActiveIntraUser }
  | { ok: false; error: string }
> {
  const resolved = await resolveIntraUserForApiRequest(tenantId, plan, request);
  if (resolved.requiresProfile || !resolved.activeIntraUser) {
    return {
      ok: false,
      error:
        "Selecione o perfil profissional. Envie X-Intra-User-Id (e X-Intra-User-Pin para administrador) ou o cookie de perfil.",
    };
  }
  return { ok: true, activeIntraUser: resolved.activeIntraUser };
}

export { PROFILE_REQUIRED_ERROR };
