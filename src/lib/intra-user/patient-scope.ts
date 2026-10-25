import type { Prisma } from "@prisma/client";

/**
 * Identidade mínima do Intra User ativo usada para segregação de dados.
 */
export interface ActiveIntraUser {
  id: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  isOwner: boolean;
  /**
   * ADMIN com PIN já configurado. MEMBER sempre false.
   * Usado só na UI do seletor — nunca inclui o hash.
   */
  hasPin: boolean;
  /**
   * MEMBER: pode cadastrar/baixar sessões e planos na ficha do paciente.
   * ADMIN: sempre tratado como true na resolução de permissões.
   */
  canManagePatientServices: boolean;
}

/** Filtro Prisma que não casa nenhum paciente (fail-closed). */
export const EMPTY_PATIENT_SCOPE: Prisma.PatientWhereInput = {
  id: { in: [] },
};

/**
 * Comportamento quando `activeIntraUser` é null:
 * - `deny` (default): nenhum paciente — seleção de perfil pendente / fail-closed.
 * - `tenant`: todos os pacientes do tenant — **só** se o caller já garantiu que
 *   o plano não exige perfil (ex.: fallback legado após validar ausência de equipe).
 *
 * Nunca trate `null` como “acesso de ADMIN” sem optar explicitamente por `tenant`.
 */
export type PatientScopeWhenNoProfile = "deny" | "tenant";

/**
 * Constrói o filtro Prisma de pacientes para o Tenant + Intra User ativo.
 *
 * No laboratório, quem opera a conta vê e edita o mesmo conjunto:
 * coletas, entregas, clientes, entregadores e o caixa.
 * O perfil só identifica quem gravou. Não filtra o que a pessoa enxerga.
 * Sem perfil ativo: ver `whenNoProfile` (default **deny**).
 */
export function buildPatientScopeWhere(params: {
  tenantId: string;
  activeIntraUser: ActiveIntraUser | null;
  whenNoProfile?: PatientScopeWhenNoProfile;
}): Prisma.PatientWhereInput {
  const { tenantId, activeIntraUser, whenNoProfile = "deny" } = params;

  if (!activeIntraUser) {
    if (whenNoProfile === "tenant") {
      return { userId: tenantId };
    }
    return { userId: tenantId, ...EMPTY_PATIENT_SCOPE };
  }

  return { userId: tenantId };
}

/**
 * Decide se um Intra User pode acessar um paciente já carregado (checagem em memória).
 * Sem perfil ativo → negado (fail-closed).
 */
export function canIntraUserAccessPatient(
  _patient: { ownerId: string | null; isShared: boolean },
  activeIntraUser: ActiveIntraUser | null,
): boolean {
  if (!activeIntraUser) return false;
  return true;
}

/**
 * Qualquer operador da conta lança no caixa. Sem perfil → false.
 */
export function canManagePatientServicesAccess(
  activeIntraUser: Pick<ActiveIntraUser, "role" | "canManagePatientServices"> | null,
): boolean {
  if (!activeIntraUser) return false;
  return true;
}

/**
 * Resolve o filtro de pacientes a partir de um escopo de sessão.
 * `null` / `denied` → escopo vazio (fail-closed). **Nunca** promove a tenant-wide.
 * Use no lugar de `scope ? buildPatientScopeWhere(scope) : { userId }`.
 */
export function scopedPatientWhereOrEmpty(
  tenantId: string,
  scope: {
    activeIntraUser: ActiveIntraUser | null;
    denied?: boolean;
  } | null,
): Prisma.PatientWhereInput {
  if (!scope || scope.denied) {
    return { userId: tenantId, ...EMPTY_PATIENT_SCOPE };
  }
  return buildPatientScopeWhere({
    tenantId,
    activeIntraUser: scope.activeIntraUser,
  });
}
