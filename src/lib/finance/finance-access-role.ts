/**
 * Resolução pura do papel financeiro (testável sem cookies/Supabase).
 * Espelha a regra de `getFinanceAccessRole` em finance-rbac.ts.
 */
export type FinanceAccessRole = "ADMIN" | "MEMBER" | "DENIED";

export type FinanceAccessRoleInput = {
  isClinica: boolean;
  requiresProfileSelection: boolean;
  activeIntraUser: { role: "ADMIN" | "MEMBER" } | null;
} | null;

/**
 * Sem sessão ou sem perfil escolhido → DENIED.
 * Qualquer operador da conta vê e lança o caixa inteiro.
 */
export function resolveFinanceAccessRole(
  ctx: FinanceAccessRoleInput,
): FinanceAccessRole {
  if (!ctx) return "DENIED";
  if (!ctx.isClinica) return "ADMIN";
  if (ctx.requiresProfileSelection || !ctx.activeIntraUser) return "DENIED";
  return "ADMIN";
}

/** MEMBER pode confirmar só entradas (INCOME) no agente / formulários. */
export function memberMayConfirmFinanceIntent(
  intent: string | null | undefined,
): boolean {
  return intent === "income" || intent === "register_income";
}
