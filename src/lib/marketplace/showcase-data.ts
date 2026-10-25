import { prisma } from "@/lib/prisma";
import { toMoneyNumber } from "@/lib/marketplace/schemas";
import { releaseExpiredMarketplaceHolds } from "@/lib/marketplace/holds";
import { organizationPlanLabel } from "@/lib/plan-tier";
import { logger } from "@/lib/logger";
import {
  distanceKm,
  professionSearchValues,
  showcaseSlotWindow,
  type ShowcaseSearch,
} from "@/lib/marketplace/showcase-search";
import { SHOWCASE_EXCLUDED_PROFESSIONS } from "@/lib/marketplace/showcase-eligibility";

const MAX_SHOWCASE_PROFESSIONALS = 48;
const MAX_SLOTS_PER_CARD = 6;

export type ShowcaseSlot = {
  id: string;
  datetime: string;
  endAt: string;
  basePrice: number;
  yieldActive: boolean;
  discountPrice: number | null;
  effectivePrice: number;
};

export type ShowcaseAudience = "public" | "patient";

export type ShowcaseProfessional = {
  profileId: string;
  name: string;
  /**
   * Consultório ou Clínica: um único card do login da conta.
   * Intra Users da equipe não geram card.
   */
  organizationLabel: "Consultório" | "Clínica" | null;
  /** Profissão do cadastro (User.profession) — destaque atual da vitrine. */
  profession: string | null;
  publicHeadline: string | null;
  publicBio: string | null;
  avatarUrl: string | null;
  /** Média de valores, só quando o profissional preencheu. */
  averagePrice: number | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  /** Endereço do consultório. Null para visitante. */
  serviceAddress: string | null;
  /** Link do mapa. Null para visitante. */
  mapsUrl: string | null;
  specialties: string[];
  /** Vazio para visitante: horário e reserva ficam atrás do login. */
  slots: ShowcaseSlot[];
  /** Paciente logado pode escolher um horário livre da agenda. */
  agendaOpen: boolean;
  /**
   * Horários livres da agenda deste profissional (o perfil que gerou a projeção).
   * Vazio para visitante.
   */
  openings: { startAt: string; endAt: string }[];
  /** Distância até a busca por raio, em km. Null quando a busca não usa localização. */
  distanceKm: number | null;
};

function toCoordinate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const raw =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(raw) ? raw : null;
}

function distanceFromSearch(
  search: ShowcaseSearch | undefined,
  latitude: unknown,
  longitude: unknown,
): number | null {
  if (!search?.radiusKm || search.latitude == null || search.longitude == null) return null;
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);
  if (lat == null || lng == null) return null;
  return distanceKm(
    { latitude: search.latitude, longitude: search.longitude },
    { latitude: lat, longitude: lng },
  );
}

/** ID estável do card na vitrine (ProfessionalProfile.id ou fallback user:…). */
export function showcaseListingId(
  pro: Pick<ShowcaseProfessional, "profileId">,
): string {
  return pro.profileId;
}

function mapSlots(
  scheduleSlots: Array<{
    id: string;
    datetime: Date;
    endAt: Date;
    basePrice: unknown;
    yieldActive: boolean;
    discountPrice: unknown;
  }>,
): ShowcaseSlot[] {
  return scheduleSlots.map((row) => {
    const basePrice = toMoneyNumber(row.basePrice);
    const discountPrice =
      row.discountPrice == null ? null : toMoneyNumber(row.discountPrice);
    const yieldActive = Boolean(row.yieldActive);
    return {
      id: row.id,
      datetime: row.datetime.toISOString(),
      endAt: row.endAt.toISOString(),
      basePrice,
      yieldActive,
      discountPrice,
      effectivePrice:
        yieldActive && discountPrice != null ? discountPrice : basePrice,
    };
  });
}

/**
 * Profissionais listáveis na vitrine B2C.
 * Quem já tinha conta entrou de uma vez. Daqui pra frente o card nasce no Premium, Consultório e Clínica.
 * A linha é sempre o User da conta (o login). Perfis Intra User não entram na lista.
 * Visitante recebe nome parcial e não recebe local, telefone, mapa nem horários.
 */
export async function getMarketplaceShowcaseProfessionals(options?: {
  search?: ShowcaseSearch;
  audience?: ShowcaseAudience;
}): Promise<ShowcaseProfessional[]> {
  try {
    try {
      await releaseExpiredMarketplaceHolds(prisma);
    } catch (holdError) {
      logger.warn("Vitrine: falha ao liberar holds expirados (seguindo listagem)", {
        feature: "marketplace-showcase",
        error:
          holdError instanceof Error ? holdError.message : String(holdError),
      });
    }

    const search = options?.search;
    const audience: ShowcaseAudience = options?.audience ?? "public";
    const revealAgenda = audience === "patient";
    const window =
      revealAgenda && search?.day ? showcaseSlotWindow(search.day, search.time) : null;
    const now = new Date();
    const slotWhere = {
      status: "AVAILABLE" as const,
      manualOffer: true,
      datetime: { gt: now },
    };
    const openingWhere = window
      ? window.instant
        ? { startAt: { lte: window.instant, gt: now }, endAt: { gt: window.instant } }
        : {
            startAt: {
              gte: window.start > now ? window.start : now,
              lt: window.end,
            },
          }
      : { startAt: { gt: now } };
    const professionValues = search?.profession
      ? professionSearchValues(search.profession)
      : [];
    const region = search?.region ?? null;
    const city = search?.city ?? null;
    const neighborhood = search?.neighborhood ?? null;
    const specialty = search?.specialty ?? null;

    const users = await prisma.user.findMany({
      where: {
        isBlocked: false,
        AND: [
          { profession: { not: null } },
          { profession: { not: "" } },
          { profession: { notIn: [...SHOWCASE_EXCLUDED_PROFESSIONS] } },
          {
            professionalProfile: {
              is: {
                showcaseApproved: true,
                ...(specialty
                  ? {
                      OR: [
                        {
                          publicSpecialty: {
                            contains: specialty,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          specialties: {
                            some: {
                              specialty: {
                                active: true,
                                name: {
                                  contains: specialty,
                                  mode: "insensitive" as const,
                                },
                              },
                            },
                          },
                        },
                      ],
                    }
                  : {}),
                ...(window ? { agendaOpenings: { some: openingWhere } } : {}),
                ...(city
                  ? { city: { contains: city, mode: "insensitive" as const } }
                  : {}),
                ...(neighborhood
                  ? {
                      neighborhood: {
                        contains: neighborhood,
                        mode: "insensitive" as const,
                      },
                    }
                  : {}),
              },
            },
          },
          ...(search?.profession
            ? [
                {
                  OR: [
                    { profession: { in: professionValues } },
                    {
                      profession: {
                        contains: search.profession,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              ]
            : []),
          ...(region
            ? [
                {
                  OR: [
                    {
                      officeAddress: {
                        contains: region,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      professionalProfile: {
                        is: {
                          city: { contains: region, mode: "insensitive" as const },
                        },
                      },
                    },
                    {
                      professionalProfile: {
                        is: {
                          neighborhood: {
                            contains: region,
                            mode: "insensitive" as const,
                          },
                        },
                      },
                    },
                    {
                      professionalProfile: {
                        is: {
                          state: {
                            equals: region.toUpperCase(),
                            mode: "insensitive" as const,
                          },
                        },
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        plan: true,
        profession: true,
        officeAddress: true,
        avatarUrl: true,
        image: true,
        professionalProfile: {
          select: {
            id: true,
            publicBio: true,
            publicHeadline: true,
            publicPhotoUrl: true,
            publicSpecialty: true,
            publicAveragePrice: true,
            allowPatientAgendaBooking: true,
            mapsUrl: true,
            city: true,
            state: true,
            neighborhood: true,
            latitude: true,
            longitude: true,
            specialties: {
              select: {
                specialty: { select: { name: true, active: true } },
              },
            },
            agendaOpenings: {
              where: openingWhere,
              orderBy: { startAt: "asc" },
              take: MAX_SLOTS_PER_CARD,
              select: { startAt: true, endAt: true },
            },
            scheduleSlots: {
              where: slotWhere,
              orderBy: [{ yieldActive: "desc" }, { datetime: "asc" }],
              take: MAX_SLOTS_PER_CARD,
              select: {
                id: true,
                datetime: true,
                endAt: true,
                basePrice: true,
                yieldActive: true,
                discountPrice: true,
              },
            },
          },
        },
      },
    });

    const cards: ShowcaseProfessional[] = users
      .filter(
        (user) =>
          Boolean(user.profession?.trim() || user.name?.trim()) &&
          Boolean(user.professionalProfile),
      )
      .map((user) => {
        const profile = user.professionalProfile!;
        const organizationLabel = organizationPlanLabel(user.plan);
        const fullName =
          user.name?.trim() || (organizationLabel ? "Clínica" : "Profissional");
        const catalogSpecialties = profile.specialties
          .filter((item) => item.specialty.active)
          .map((item) => item.specialty.name);
        const writtenSpecialty = profile.publicSpecialty?.trim() || null;
        const specialties = writtenSpecialty
          ? [writtenSpecialty, ...catalogSpecialties.filter((name) => name !== writtenSpecialty)]
          : catalogSpecialties;
        const average =
          profile.publicAveragePrice == null
            ? null
            : toMoneyNumber(profile.publicAveragePrice);
        return {
          profileId: profile.id,
          name: fullName,
          organizationLabel,
          profession: user.profession?.trim() || null,
          publicHeadline: profile.publicHeadline?.trim() || null,
          publicBio: profile.publicBio?.trim() || null,
          avatarUrl: profile.publicPhotoUrl || user.avatarUrl || user.image,
          averagePrice: average,
          city: profile.city,
          state: profile.state,
          neighborhood: profile.neighborhood,
          serviceAddress: user.officeAddress?.trim() || null,
          mapsUrl: profile.mapsUrl,
          specialties,
          slots: revealAgenda ? mapSlots(profile.scheduleSlots) : [],
          agendaOpen: revealAgenda && profile.allowPatientAgendaBooking,
          openings: revealAgenda
            ? profile.agendaOpenings.map((opening) => ({
                startAt: opening.startAt.toISOString(),
                endAt: opening.endAt.toISOString(),
              }))
            : [],
          distanceKm: distanceFromSearch(search, profile.latitude, profile.longitude),
        };
      });

    const located = cards.filter((card) => {
      if (!search?.radiusKm || search.latitude == null || search.longitude == null) return true;
      return card.distanceKm != null && card.distanceKm <= search.radiusKm;
    });

    located.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      const aSlots = a.slots.length > 0 ? 1 : 0;
      const bSlots = b.slots.length > 0 ? 1 : 0;
      if (aSlots !== bSlots) return bSlots - aSlots;
      return a.name.localeCompare(b.name, "pt-BR");
    });

    return located.slice(0, MAX_SHOWCASE_PROFESSIONALS);
  } catch (error) {
    logger.error("Falha ao carregar vitrine B2C", {
      feature: "marketplace-showcase",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Profissões distintas já listadas na vitrine (para filtro do paciente). */
export async function getShowcaseProfessionOptions(): Promise<string[]> {
  try {
    const rows = await prisma.user.findMany({
      where: {
        isBlocked: false,
        professionalProfile: { is: { showcaseApproved: true } },
        AND: [
          { profession: { not: null } },
          { profession: { not: "" } },
          { profession: { notIn: [...SHOWCASE_EXCLUDED_PROFESSIONS] } },
        ],
      },
      select: { profession: true },
      orderBy: { profession: "asc" },
      take: 200,
    });
    const eligible = rows;
    return [...new Set(
      eligible
        .map((row) => row.profession?.trim())
        .filter((value): value is string => Boolean(value)),
    )].slice(0, 40);
  } catch {
    return [];
  }
}

export type YieldShowcaseOffer = {
  slotId: string;
  startAt: string;
  basePrice: number;
  discountPrice: number;
  profileId: string;
  professionalName: string;
  organizationLabel: "Consultório" | "Clínica" | null;
  profession: string | null;
  specialty: string | null;
};

function yieldOfferWhere() {
  return {
    status: "AVAILABLE" as const,
    manualOffer: true,
    yieldActive: true,
    discountPrice: { not: null },
    datetime: { gt: new Date() },
    professional: {
      user: {
        isBlocked: false,
        AND: [
          { profession: { not: null } },
          { profession: { notIn: [...SHOWCASE_EXCLUDED_PROFESSIONS] } },
        ],
      },
    },
  };
}

/** Horários que o profissional ofertou na Gestão de Rendimento. */
export async function getYieldShowcaseOffers(): Promise<YieldShowcaseOffer[]> {
  try {
    const rows = await prisma.scheduleSlot.findMany({
      where: yieldOfferWhere(),
      orderBy: [{ datetime: "asc" }],
      take: 80,
      select: {
        id: true,
        datetime: true,
        basePrice: true,
        discountPrice: true,
        professional: {
          select: {
            id: true,
            publicSpecialty: true,
            user: { select: { name: true, profession: true, plan: true } },
            specialties: {
              where: { specialty: { active: true } },
              select: { specialty: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    });
    return rows.flatMap((row) => {
      if (row.discountPrice == null) return [];
      const specialty =
        row.professional.publicSpecialty?.trim() ||
        row.professional.specialties[0]?.specialty.name ||
        null;
      return [
        {
          slotId: row.id,
          startAt: row.datetime.toISOString(),
          basePrice: toMoneyNumber(row.basePrice),
          discountPrice: toMoneyNumber(row.discountPrice),
          profileId: row.professional.id,
          professionalName: row.professional.user.name?.trim() || "Profissional",
          organizationLabel: organizationPlanLabel(row.professional.user.plan),
          profession: row.professional.user.profession?.trim() || null,
          specialty,
        },
      ];
    });
  } catch (error) {
    logger.error("Falha ao carregar horários com desconto", {
      feature: "marketplace-showcase",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function countYieldShowcaseOffers(): Promise<number> {
  try {
    return await prisma.scheduleSlot.count({ where: yieldOfferWhere() });
  } catch {
    return 0;
  }
}
