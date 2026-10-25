import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { professionPublicLabel } from "@/lib/profession-options";
import {
  isShowcaseEligibleProfession,
  SHOWCASE_EXCLUDED_PROFESSIONS,
} from "@/lib/marketplace/showcase-eligibility";

export type CensusBar = {
  label: string;
  count: number;
};

export type ShowcasePublicCensus = {
  total: number;
  professions: CensusBar[];
  specialties: CensusBar[];
  places: CensusBar[];
};

const BAR_LIMIT = 8;

function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Agrupa rótulos iguais ignorando acento e maiúsculas. Mantém no máximo `limit` barras e soma o resto em "Outras". */
export function censusBars(
  labels: Array<string | null | undefined>,
  limit = BAR_LIMIT,
): CensusBar[] {
  const buckets = new Map<string, CensusBar>();
  for (const raw of labels) {
    const label = raw?.trim();
    if (!label) continue;
    const key = foldKey(label);
    const current = buckets.get(key);
    if (current) current.count += 1;
    else buckets.set(key, { label, count: 1 });
  }
  const sorted = [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
  );
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, row) => sum + row.count, 0);
  if (rest > 0) head.push({ label: "Outras", count: rest });
  return head;
}

export function censusPlaceLabel(input: {
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
}): string | null {
  const city = input.city?.trim();
  const state = input.state?.trim();
  const neighborhood = input.neighborhood?.trim();
  if (city && state) return `${city} · ${state}`;
  if (city) return city;
  if (neighborhood && state) return `${neighborhood} · ${state}`;
  if (neighborhood) return neighborhood;
  if (state) return state;
  return null;
}

function specialtyLabels(profile: {
  publicSpecialty: string | null;
  specialties: Array<{ specialty: { name: string } }>;
}): string[] {
  const named = profile.publicSpecialty?.trim();
  if (named) return [named];
  return profile.specialties
    .map((item) => item.specialty.name.trim())
    .filter(Boolean);
}

/**
 * Totais públicos da vitrine. Só contagens por área, especialidade e cidade.
 * Não devolve nome, telefone, endereço completo nem horário.
 */
const EMPTY_CENSUS: ShowcasePublicCensus = {
  total: 0,
  professions: [],
  specialties: [],
  places: [],
};

export async function getShowcasePublicCensus(): Promise<ShowcasePublicCensus> {
  try {
    return await loadShowcasePublicCensus();
  } catch (error) {
    logger.error("Falha ao montar o resumo público da vitrine", {
      feature: "marketplace-showcase",
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_CENSUS;
  }
}

async function loadShowcasePublicCensus(): Promise<ShowcasePublicCensus> {
  const rows = await prisma.user.findMany({
    where: {
      isBlocked: false,
      AND: [
        { profession: { not: null } },
        { profession: { not: "" } },
        { profession: { notIn: [...SHOWCASE_EXCLUDED_PROFESSIONS] } },
        { professionalProfile: { is: { showcaseApproved: true } } },
      ],
    },
    select: {
      profession: true,
      professionalProfile: {
        select: {
          publicSpecialty: true,
          city: true,
          state: true,
          neighborhood: true,
          specialties: {
            where: { specialty: { active: true } },
            select: { specialty: { select: { name: true } } },
            take: 4,
          },
        },
      },
    },
  });

  const professions: string[] = [];
  const specialties: string[] = [];
  const places: string[] = [];
  for (const row of rows) {
    const profession = professionPublicLabel(row.profession);
    if (!isShowcaseEligibleProfession(profession) || !row.professionalProfile) continue;
    professions.push(profession);
    specialties.push(
      ...specialtyLabels(row.professionalProfile).filter(isShowcaseEligibleProfession),
    );
    const place = censusPlaceLabel(row.professionalProfile);
    if (place) places.push(place);
  }

  return {
    total: professions.length,
    professions: censusBars(professions),
    specialties: censusBars(specialties),
    places: censusBars(places),
  };
}
