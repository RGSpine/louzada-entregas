import "server-only";

import { getIntraUserContext } from "@/lib/intra-user/context";
import { canManagePatientServicesAccess } from "@/lib/intra-user/patient-scope";
import { requireOfficeFinanceUser } from "@/lib/office-finance-access";
import {
  resolveFinanceAccessRole,
  type FinanceAccessRole,
} from "@/lib/finance/finance-access-role";

export type { FinanceAccessRole };

/**
 * Papel financeiro do perfil ativo. Planos individuais e o dono operam como ADMIN.
 * MEMBER (clínica) tem acesso restrito: só Catálogo (visualização) e Adicionar Entradas.
 * Sem perfil ativo em plano de equipe → DENIED (fail-closed; nunca promover a ADMIN).
 */
export async function getFinanceAccessRole(): Promise<FinanceAccessRole> {
  const ctx = await getIntraUserContext();
  if (!ctx) return resolveFinanceAccessRole(null);
  return resolveFinanceAccessRole({
    isClinica: ctx.isClinica,
    requiresProfileSelection: ctx.requiresProfileSelection,
    activeIntraUser: ctx.activeIntraUser
      ? { role: ctx.activeIntraUser.role }
      : null,
  });
}

/** True quando o perfil ativo pode ver relatório completo / fiscal / despesas. */
export async function canAccessFinanceAdminAreas(): Promise<boolean> {
  const role = await getFinanceAccessRole();
  return role === "ADMIN";
}

/**
 * Gate: autenticação + plano Premium+ + papel ADMIN.
 * Retorna userId do tenant para uso nas actions.
 */
export async function requireFinanceAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const planAccess = await requireOfficeFinanceUser();
  if (!planAccess.ok) {
    return planAccess;
  }
  const role = await getFinanceAccessRole();
  if (role === "DENIED") {
    return { ok: false, error: "Selecione o perfil profissional para continuar." };
  }
  if (role !== "ADMIN") {
    return {
      ok: false,
      error: "Acesso restrito: apenas administradores da clínica podem ver esta área financeira.",
    };
  }
  return { ok: true, userId: planAccess.userId };
}

const PATIENT_SERVICES_DENIED =
  "Sem permissão para cadastrar planos ou baixar sessões neste paciente. Peça ao administrador da clínica.";

/**
 * Gate: pode vender/baixar sessões na ficha do paciente (Serviços / Fiscal).
 * ADMIN sempre; MEMBER só se `canManagePatientServices` estiver ligado pelo ADMIN.
 * Planos individuais (sem equipe) → liberado.
 */
export async function requirePatientServicesManage(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const planAccess = await requireOfficeFinanceUser();
  if (!planAccess.ok) {
    return planAccess;
  }
  const ctx = await getIntraUserContext();
  if (!ctx) {
    return { ok: false, error: "Não autenticado." };
  }
  if (ctx.isClinica && (ctx.requiresProfileSelection || !ctx.activeIntraUser)) {
    return { ok: false, error: "Selecione o perfil profissional para continuar." };
  }
  if (!ctx.isClinica) {
    return { ok: true, userId: planAccess.userId };
  }
  if (!canManagePatientServicesAccess(ctx.activeIntraUser)) {
    return { ok: false, error: PATIENT_SERVICES_DENIED };
  }
  return { ok: true, userId: planAccess.userId };
}

/** Flag efetiva para a UI (true em planos individuais / ADMIN / MEMBER liberado). */
export async function getPatientServicesManageAccess(): Promise<
  { ok: true; canManage: boolean } | { ok: false; error: string }
> {
  const planAccess = await requireOfficeFinanceUser();
  if (!planAccess.ok) {
    return { ok: false, error: planAccess.error };
  }
  const ctx = await getIntraUserContext();
  if (!ctx) {
    return { ok: false, error: "Não autenticado." };
  }
  if (ctx.isClinica && (ctx.requiresProfileSelection || !ctx.activeIntraUser)) {
    return { ok: false, error: "Selecione o perfil profissional para continuar." };
  }
  if (!ctx.isClinica) {
    return { ok: true, canManage: true };
  }
  return {
    ok: true,
    canManage: canManagePatientServicesAccess(ctx.activeIntraUser),
  };
}
