import { prisma } from "@/lib/prisma";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import { RECOMMENDATIONS_CACHE_TTL_MS } from "@/lib/clinical-chat/constants";

export type ClinicalRecommendationItem = ClinicalChatCitation & {
  matchedTopic?: string | null;
};

export type CachedClinicalRecommendations = {
  items: ClinicalRecommendationItem[];
  rationale: string | null;
  generatedAt: string;
  fromCache: boolean;
  profileTags: string[];
  sessionsAnalyzed: number;
  profileFingerprint?: string;
  source?: "on_demand" | "daily_cron";
};

type CacheEntry = {
  payload: CachedClinicalRecommendations;
  expiresAt: number;
  profileFingerprint: string;
};

const memoryStore = new Map<string, CacheEntry>();

function isPayloadShape(value: unknown): value is {
  items: ClinicalRecommendationItem[];
  generatedAt: string;
  rationale?: string | null;
  profileTags?: string[];
  sessionsAnalyzed?: number;
  profileFingerprint?: string;
  source?: "on_demand" | "daily_cron";
} {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items) || typeof v.generatedAt !== "string") return false;
  if (v.profileTags !== undefined && !Array.isArray(v.profileTags)) return false;
  if (v.sessionsAnalyzed !== undefined && typeof v.sessionsAnalyzed !== "number") return false;
  return true;
}

/** Normaliza payloads antigos (pré-profileTags/sessionsAnalyzed) para o shape atual. */
function normalizeCachedPayload(
  raw: {
    items: ClinicalRecommendationItem[];
    generatedAt: string;
    rationale?: string | null;
    profileTags?: string[];
    sessionsAnalyzed?: number;
    source?: "on_demand" | "daily_cron";
  },
  extras: { fromCache: boolean; profileFingerprint: string },
): CachedClinicalRecommendations {
  return {
    items: raw.items,
    rationale: raw.rationale ?? null,
    generatedAt: raw.generatedAt,
    profileTags: Array.isArray(raw.profileTags) ? raw.profileTags : [],
    sessionsAnalyzed: typeof raw.sessionsAnalyzed === "number" ? raw.sessionsAnalyzed : 0,
    source: raw.source,
    fromCache: extras.fromCache,
    profileFingerprint: extras.profileFingerprint,
  };
}

export async function getCachedClinicalRecommendations(
  userId: string,
): Promise<CachedClinicalRecommendations | null> {
  const mem = memoryStore.get(userId);
  if (mem && Date.now() <= mem.expiresAt) {
    return normalizeCachedPayload(mem.payload, {
      fromCache: true,
      profileFingerprint: mem.profileFingerprint,
    });
  }
  if (mem) memoryStore.delete(userId);

  const row = await prisma.clinicalRecommendationsCache.findUnique({
    where: { userId },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.clinicalRecommendationsCache
      .delete({ where: { userId } })
      .catch(() => undefined);
    return null;
  }
  if (!isPayloadShape(row.payload)) return null;

  const cached = normalizeCachedPayload(row.payload, {
    fromCache: true,
    profileFingerprint: row.profileFingerprint,
  });
  memoryStore.set(userId, {
    payload: cached,
    expiresAt: row.expiresAt.getTime(),
    profileFingerprint: row.profileFingerprint,
  });
  return cached;
}

export async function getCachedRecommendationsMeta(
  userId: string,
): Promise<{ profileFingerprint: string; generatedAt: Date; expiresAt: Date } | null> {
  const row = await prisma.clinicalRecommendationsCache.findUnique({
    where: { userId },
    select: { profileFingerprint: true, generatedAt: true, expiresAt: true },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function setCachedClinicalRecommendations(
  userId: string,
  payload: Omit<CachedClinicalRecommendations, "fromCache">,
  options?: { profileFingerprint: string; ttlMs?: number },
): Promise<CachedClinicalRecommendations> {
  const fingerprint = options?.profileFingerprint ?? payload.profileFingerprint ?? "";
  const ttlMs = options?.ttlMs ?? RECOMMENDATIONS_CACHE_TTL_MS;
  const generatedAt = new Date(payload.generatedAt);
  const expiresAt = new Date(generatedAt.getTime() + ttlMs);

  const cached: CachedClinicalRecommendations = {
    ...payload,
    fromCache: false,
    profileFingerprint: fingerprint,
  };

  memoryStore.set(userId, {
    payload: cached,
    expiresAt: expiresAt.getTime(),
    profileFingerprint: fingerprint,
  });

  await prisma.clinicalRecommendationsCache.upsert({
    where: { userId },
    create: {
      userId,
      payload: {
        items: cached.items,
        rationale: cached.rationale,
        generatedAt: cached.generatedAt,
        profileTags: cached.profileTags,
        sessionsAnalyzed: cached.sessionsAnalyzed,
        source: cached.source ?? "on_demand",
      },
      profileFingerprint: fingerprint,
      generatedAt,
      expiresAt,
    },
    update: {
      payload: {
        items: cached.items,
        rationale: cached.rationale,
        generatedAt: cached.generatedAt,
        profileTags: cached.profileTags,
        sessionsAnalyzed: cached.sessionsAnalyzed,
        source: cached.source ?? "on_demand",
      },
      profileFingerprint: fingerprint,
      generatedAt,
      expiresAt,
    },
  });

  return cached;
}

export async function clearCachedClinicalRecommendations(userId: string): Promise<void> {
  memoryStore.delete(userId);
  await prisma.clinicalRecommendationsCache.deleteMany({ where: { userId } });
}
