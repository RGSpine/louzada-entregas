import {
  dedupeCitations,
  ensureUniqueCitationIds,
} from "@/lib/clinical-chat/citations";
import { getClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";
import { clinicalProfileFingerprint } from "@/lib/clinical-chat/clinical-profile-fingerprint";
import { generateRecommendationQueries } from "@/lib/clinical-chat/generate-recommendation-queries";
import { getRecentChatSignals } from "@/lib/clinical-chat/recent-chat-signals";
import type { RecentChatSignalsSnapshot } from "@/lib/clinical-chat/recent-chat-signals";
import {
  isClinicalEvidenceSearchAvailable,
  searchClinicalEvidence,
} from "@/lib/clinical-chat/evidence-search";
import {
  attachMatchedTopics,
  matchRecommendationTopic,
} from "@/lib/clinical-chat/match-recommendation-topic";
import {
  RECOMMENDATIONS_CACHE_TTL_MS,
  RECOMMENDATIONS_DAILY_CACHE_TTL_MS,
  RECOMMENDATIONS_MAX_ARTICLES,
  RECOMMENDATIONS_MAX_QUERIES,
} from "@/lib/clinical-chat/constants";
import {
  clearCachedClinicalRecommendations,
  getCachedClinicalRecommendations,
  setCachedClinicalRecommendations,
  type CachedClinicalRecommendations,
  type ClinicalRecommendationItem,
} from "@/lib/clinical-chat/recommendations-cache";

export type { ClinicalRecommendationItem, CachedClinicalRecommendations };

export type RunClinicalRecommendationsResult =
  | { ok: true; data: CachedClinicalRecommendations }
  | {
      ok: false;
      code: "no_signals" | "no_queries" | "evidence_unavailable" | "no_results";
      message: string;
    };

export type RunClinicalRecommendationsOptions = {
  refresh?: boolean;
  /** Cron diário: exige Perfil Clínico e prioriza tags nos queries. */
  source?: "on_demand" | "daily_cron";
};

/** Reaplica matching no hit de cache (corrige rótulos antigos sem gastar API). */
function rematchCachedItems(
  data: CachedClinicalRecommendations,
): CachedClinicalRecommendations {
  if (data.profileTags.length === 0 || data.items.length === 0) return data;
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      matchedTopic: matchRecommendationTopic(item, data.profileTags),
    })),
  };
}

export async function runClinicalRecommendations(
  userId: string,
  options?: RunClinicalRecommendationsOptions,
): Promise<RunClinicalRecommendationsResult> {
  const source = options?.source ?? "on_demand";
  const isDaily = source === "daily_cron";

  if (!options?.refresh && !isDaily) {
    const cached = await getCachedClinicalRecommendations(userId);
    if (cached) {
      return { ok: true, data: rematchCachedItems(cached) };
    }
  } else if (options?.refresh) {
    await clearCachedClinicalRecommendations(userId);
  }

  const emptyChats: RecentChatSignalsSnapshot = { signals: [], sessionsAnalyzed: 0 };
  const [profile, chats] = await Promise.all([
    getClinicalProfileSnapshot(userId),
    isDaily
      ? getRecentChatSignals(userId).catch(() => emptyChats)
      : getRecentChatSignals(userId),
  ]);

  const fingerprint = clinicalProfileFingerprint(profile);

  if (isDaily && profile.topTags.length === 0) {
    return {
      ok: false,
      code: "no_signals",
      message: "Perfil clínico insuficiente para indicações diárias.",
    };
  }

  if (profile.topTags.length === 0 && chats.signals.length === 0) {
    return {
      ok: false,
      code: "no_signals",
      message:
        "Ainda não há conversas nem perfil clínico suficiente. Continue usando a Ester e registrando evoluções.",
    };
  }

  const { searchQueries, rationale } = await generateRecommendationQueries(profile, chats, {
    prioritizeProfile: isDaily || profile.topTags.length > 0,
  });

  if (searchQueries.length === 0) {
    return {
      ok: false,
      code: "no_queries",
      message: "Não foi possível montar temas de busca a partir do seu histórico.",
    };
  }

  if (!isClinicalEvidenceSearchAvailable()) {
    return {
      ok: false,
      code: "evidence_unavailable",
      message: "Busca de evidência não configurada no servidor.",
    };
  }

  const citations = ensureUniqueCitationIds(
    await searchClinicalEvidence(searchQueries, {
      maxQueries: RECOMMENDATIONS_MAX_QUERIES,
      maxCitations: RECOMMENDATIONS_MAX_ARTICLES,
    }),
  );

  if (citations.length === 0) {
    return {
      ok: false,
      code: "no_results",
      message: "Nenhum artigo relevante encontrado agora. Tente atualizar mais tarde.",
    };
  }

  const profileTags = profile.topTags.map((t) => t.tag);
  const items = attachMatchedTopics(dedupeCitations(citations), searchQueries, profileTags);

  const data = await setCachedClinicalRecommendations(
    userId,
    {
      items,
      rationale: rationale ?? null,
      generatedAt: new Date().toISOString(),
      profileTags,
      sessionsAnalyzed: chats.sessionsAnalyzed,
      profileFingerprint: fingerprint,
      source,
    },
    {
      profileFingerprint: fingerprint,
      ttlMs: isDaily ? RECOMMENDATIONS_DAILY_CACHE_TTL_MS : RECOMMENDATIONS_CACHE_TTL_MS,
    },
  );

  return { ok: true, data };
}
