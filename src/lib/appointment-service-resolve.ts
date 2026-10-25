import { prisma } from "@/lib/prisma";
import {
  resolveServiceIdFromGuess,
  type OfficeFinanceContextService,
} from "@/lib/office-finance-ai-extract";

export type CatalogServiceRef = {
  id: string;
  name: string;
  defaultPriceCents: number;
  /** Espaço do serviço no catálogo (Consultório/Clínica). */
  serviceSpaceId?: string | null;
};

export function resolveServiceIdByUniquePrice(
  priceCents: number,
  services: CatalogServiceRef[],
): { id: string; name: string } | null {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
  const matches = services.filter((s) => s.defaultPriceCents === priceCents);
  return matches.length === 1 ? { id: matches[0]!.id, name: matches[0]!.name } : null;
}

/**
 * Associa marcação ao catálogo: nome mencionado tem prioridade; valor único no catálogo é fallback.
 */
export function resolveCatalogServiceForAppointment(input: {
  serviceNameGuess?: string | null;
  priceCents?: number | null;
  services: CatalogServiceRef[];
}): {
  id: string;
  name: string;
  defaultPriceCents: number;
  serviceSpaceId: string | null;
} | null {
  const { services } = input;
  if (services.length === 0) return null;

  const byName = resolveServiceIdFromGuess(input.serviceNameGuess ?? null, services);
  if (byName) {
    const row = services.find((s) => s.id === byName.id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      defaultPriceCents: row.defaultPriceCents,
      serviceSpaceId: row.serviceSpaceId ?? null,
    };
  }

  if (input.priceCents != null && input.priceCents > 0) {
    const byPrice = resolveServiceIdByUniquePrice(input.priceCents, services);
    if (byPrice) {
      const row = services.find((s) => s.id === byPrice.id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        defaultPriceCents: row.defaultPriceCents,
        serviceSpaceId: row.serviceSpaceId ?? null,
      };
    }
  }

  return null;
}

export async function listActiveCatalogServicesForUser(
  professionalUserId: string,
): Promise<CatalogServiceRef[]> {
  const rows = await prisma.professionalService.findMany({
    where: { userId: professionalUserId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultPriceCents: true, serviceSpaceId: true },
  });
  return rows;
}

export async function resolveCatalogServiceForAppointmentForUser(
  professionalUserId: string,
  input: { serviceNameGuess?: string | null; priceCents?: number | null },
): Promise<{
  id: string;
  name: string;
  defaultPriceCents: number;
  serviceSpaceId: string | null;
} | null> {
  const services = await listActiveCatalogServicesForUser(professionalUserId);
  return resolveCatalogServiceForAppointment({ ...input, services });
}
