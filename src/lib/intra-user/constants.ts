import type { PlanTier } from "@/lib/plan-tier";

/** Cookie httpOnly com o id do Intra User (perfil) ativo na sessão. */
export const INTRA_USER_COOKIE = "louzada_intra_user";

/** Cor padrão do Intra User (agenda). */
export const DEFAULT_INTRA_USER_COLOR = "#2563EB";

/**
 * Paleta sugerida de cores para novos Intra Users (identificação na agenda).
 * ≥10 tons distintos (teto Clínica); o usuário pode escolher qualquer HEX.
 */
export const INTRA_USER_COLOR_PALETTE = [
  "#2563EB", // azul
  "#DC2626", // vermelho
  "#059669", // verde
  "#D97706", // âmbar
  "#7C3AED", // roxo
  "#DB2777", // rosa
  "#0891B2", // ciano
  "#4B5563", // cinza
  "#EA580C", // laranja
  "#0D9488", // teal
  "#CA8A04", // amarelo-escuro
  "#4338CA", // índigo
] as const;

/**
 * Máximo de Intra Users por plano (INCLUINDO o dono/ADMIN).
 * Consultório = 5, Clínica = 10. Planos individuais operam com 1 perfil (o titular).
 * Gestão da equipe continua restrita a perfil ADMIN (PIN).
 */
export function maxIntraUsersForPlan(_tier: PlanTier): number {
  return 10;
}

/** Equipe do spin-off: vários intra users e seletor de perfil. */
export function planSupportsIntraUsers(_tier: PlanTier): boolean {
  return true;
}

/** Valida um HEX #RRGGBB (7 caracteres). */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}
