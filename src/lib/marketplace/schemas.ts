import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

export const MAX_MARKETPLACE_SEARCH_ROWS = 200;
export const MAX_SLOTS_PER_PROFESSIONAL = 12;
export const SLOT_TAKEN_MESSAGE = "Horário recém-reservado";

export const searchProfessionalsSchema = z.object({
  latitude: z.coerce
    .number({ error: "Latitude inválida." })
    .gte(-90, "Latitude inválida.")
    .lte(90, "Latitude inválida."),
  longitude: z.coerce
    .number({ error: "Longitude inválida." })
    .gte(-180, "Longitude inválida.")
    .lte(180, "Longitude inválida."),
  specialty: z
    .string({ error: "Informe a especialidade." })
    .trim()
    .min(1, "Informe a especialidade.")
    .max(120, "Especialidade muito longa.")
    .transform((value) => sanitizeText(value)),
  radiusKm: z.coerce
    .number({ error: "Raio inválido." })
    .positive("Raio deve ser maior que zero.")
    .max(100, "Raio máximo: 100 km.")
    .default(10),
});

export const bookScheduleSlotSchema = z.object({
  slotId: z
    .string({ error: "Informe o horário." })
    .trim()
    .min(1, "Informe o horário.")
    .max(64, "Identificador de horário inválido."),
});

export type SearchProfessionalsInput = z.infer<typeof searchProfessionalsSchema>;
export type BookScheduleSlotInput = z.infer<typeof bookScheduleSlotSchema>;

export type MarketplaceSearchRow = {
  profileId: string;
  userId: string;
  professionalName: string | null;
  profession: string | null;
  avatarUrl: string | null;
  image: string | null;
  publicPhotoUrl: string | null;
  publicBio: string | null;
  publicHeadline: string | null;
  mapsUrl: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  latitude: unknown;
  longitude: unknown;
  yieldManagementEnabled: boolean;
  distanceMeters: unknown;
  specialtyId: string;
  specialtyName: string;
  specialtySlug: string;
  slotId: string;
  datetime: Date;
  endAt: Date;
  basePrice: unknown;
  yieldActive: boolean;
  discountPrice: unknown;
};

export type MarketplaceSlot = {
  id: string;
  datetime: string;
  endAt: string;
  basePrice: number;
  yieldActive: boolean;
  discountPrice: number | null;
  effectivePrice: number;
};

export type MarketplaceSpecialty = {
  id: string;
  name: string;
  slug: string;
};

export type MarketplaceProfessional = {
  profileId: string;
  userId: string;
  name: string;
  profession: string | null;
  avatarUrl: string | null;
  publicBio: string | null;
  publicHeadline: string | null;
  mapsUrl: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number;
  yieldManagementEnabled: boolean;
  specialties: MarketplaceSpecialty[];
  slots: MarketplaceSlot[];
};

export function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toMoneyNumber(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return 0;
  return Math.round(parsed * 100) / 100;
}

export function firstZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}

export function groupMarketplaceSearchRows(
  rows: MarketplaceSearchRow[],
  maxSlotsPerProfessional = MAX_SLOTS_PER_PROFESSIONAL,
): MarketplaceProfessional[] {
  const professionals = new Map<string, MarketplaceProfessional>();
  const slotIdsByProfile = new Map<string, Set<string>>();
  const specialtyIdsByProfile = new Map<string, Set<string>>();

  for (const row of rows) {
    let professional = professionals.get(row.profileId);
    if (!professional) {
      const distanceMeters = toFiniteNumber(row.distanceMeters) ?? 0;
      professional = {
        profileId: row.profileId,
        userId: row.userId,
        name: row.professionalName?.trim() || "Profissional",
        profession: row.profession,
        avatarUrl: row.publicPhotoUrl || row.avatarUrl || row.image,
        publicBio: row.publicBio?.trim() || null,
        publicHeadline: row.publicHeadline?.trim() || null,
        mapsUrl: row.mapsUrl?.trim() || null,
        city: row.city,
        state: row.state,
        neighborhood: row.neighborhood,
        latitude: toFiniteNumber(row.latitude),
        longitude: toFiniteNumber(row.longitude),
        distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
        yieldManagementEnabled: Boolean(row.yieldManagementEnabled),
        specialties: [],
        slots: [],
      };
      professionals.set(row.profileId, professional);
      slotIdsByProfile.set(row.profileId, new Set());
      specialtyIdsByProfile.set(row.profileId, new Set());
    }

    const specialtyIds = specialtyIdsByProfile.get(row.profileId)!;
    if (!specialtyIds.has(row.specialtyId)) {
      specialtyIds.add(row.specialtyId);
      professional.specialties.push({
        id: row.specialtyId,
        name: row.specialtyName,
        slug: row.specialtySlug,
      });
    }

    const slotIds = slotIdsByProfile.get(row.profileId)!;
    if (slotIds.has(row.slotId) || professional.slots.length >= maxSlotsPerProfessional) {
      continue;
    }

    const basePrice = toMoneyNumber(row.basePrice);
    const discountPrice =
      row.discountPrice == null ? null : toMoneyNumber(row.discountPrice);
    const yieldActive = Boolean(row.yieldActive);
    const datetime =
      row.datetime instanceof Date ? row.datetime : new Date(row.datetime);
    const endAt = row.endAt instanceof Date ? row.endAt : new Date(row.endAt);

    slotIds.add(row.slotId);
    professional.slots.push({
      id: row.slotId,
      datetime: datetime.toISOString(),
      endAt: endAt.toISOString(),
      basePrice,
      yieldActive,
      discountPrice,
      effectivePrice:
        yieldActive && discountPrice != null ? discountPrice : basePrice,
    });
  }

  return Array.from(professionals.values());
}
