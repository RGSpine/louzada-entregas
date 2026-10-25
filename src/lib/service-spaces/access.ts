/**
 * Espaços de Serviços — limites, cores e filtros.
 * Gate boolean: `canUseServiceSpaces` em `@/lib/plan-limits` (Consultório/Clínica).
 */
import type { PlanTier } from "@/lib/plan-tier";
import { isValidHexColor } from "@/lib/intra-user/constants";
export { canUseServiceSpaces } from "@/lib/plan-limits";

export const DEFAULT_SERVICE_SPACE_COLOR = "#0F766E";

/** Paleta sugerida (distinta da de Intra Users para contraste na agenda). */
export const SERVICE_SPACE_COLOR_PALETTE = [
  "#0F766E", // teal
  "#B45309", // amber escuro
  "#7C3AED", // violeta
  "#BE123C", // rose
  "#0369A1", // sky
  "#15803D", // green
  "#C2410C", // orange
  "#4C1D95", // indigo
] as const;

export function maxServiceSpacesForPlan(tier: PlanTier | null): number {
  if (tier === "CONSULTORIO") return 8;
  if (tier === "CLINICA") return 30;
  return 0;
}

export function assertValidServiceSpaceColor(color: string): string | null {
  const trimmed = color.trim();
  if (!isValidHexColor(trimmed)) return null;
  return trimmed.toUpperCase();
}

/** Filtro de leitura: null/undefined/"all" = visão consolidada. */
export type ServiceSpaceViewFilter = "all" | { spaceId: string };

export function parseServiceSpaceViewParam(
  raw: string | null | undefined,
): ServiceSpaceViewFilter {
  if (!raw || raw === "all" || raw === "") return "all";
  return { spaceId: raw };
}

/**
 * Where Prisma para listagens: "all" não restringe;
 * espaço concreto = esse id OU null (catálogo/lançamento geral), conforme `includeGeneral`.
 */
export function serviceSpaceWhere(
  filter: ServiceSpaceViewFilter,
  opts?: { includeGeneral?: boolean },
): { serviceSpaceId: string } | { OR: Array<{ serviceSpaceId: string | null }> } | undefined {
  if (filter === "all") return undefined;
  const includeGeneral = opts?.includeGeneral !== false;
  if (includeGeneral) {
    return {
      OR: [{ serviceSpaceId: filter.spaceId }, { serviceSpaceId: null }],
    };
  }
  return { serviceSpaceId: filter.spaceId };
}

export const SERVICE_SPACES_PLAN_ERROR =
  "Espaços de Serviços estão disponíveis nos planos Consultório e Clínica.";
