import { prisma } from "@/lib/prisma";
import { canUsePatientClinicalChat } from "@/lib/plan-limits";
import { getClinicalProfileSnapshot } from "@/lib/clinical-chat/clinical-profile-snapshot";
import { clinicalProfileFingerprint } from "@/lib/clinical-chat/clinical-profile-fingerprint";
import {
  RECOMMENDATIONS_DAILY_BATCH_SIZE,
  RECOMMENDATIONS_DAILY_CONCURRENCY,
  RECOMMENDATIONS_DAILY_MIN_PROFILE_TAGS,
  RECOMMENDATIONS_DAILY_MIN_REFRESH_MS,
} from "@/lib/clinical-chat/constants";
import { getCachedRecommendationsMeta } from "@/lib/clinical-chat/recommendations-cache";
import { runClinicalRecommendations } from "@/lib/clinical-chat/run-clinical-recommendations";
import { isClinicalEvidenceSearchAvailable } from "@/lib/clinical-chat/evidence-search";
import { logger } from "@/lib/logger";

export type DailyClinicalRecommendationsSummary = {
  candidates: number;
  processed: number;
  refreshed: number;
  skippedFresh: number;
  skippedNoProfile: number;
  skippedIneligible: number;
  failed: number;
  evidenceUnavailable: boolean;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Pré-gera Indicações (PubMed/Perplexity) para profissionais elegíveis
 * com base no status atual do Perfil Clínico (Estatísticas).
 */
export async function runDailyClinicalRecommendations(options?: {
  limit?: number;
}): Promise<DailyClinicalRecommendationsSummary> {
  const summary: DailyClinicalRecommendationsSummary = {
    candidates: 0,
    processed: 0,
    refreshed: 0,
    skippedFresh: 0,
    skippedNoProfile: 0,
    skippedIneligible: 0,
    failed: 0,
    evidenceUnavailable: !isClinicalEvidenceSearchAvailable(),
  };

  if (summary.evidenceUnavailable) {
    logger.warn("Cron indicações: evidência indisponível (APIs)", {
      feature: "daily-clinical-recommendations",
    });
    return summary;
  }

  const limit = options?.limit ?? RECOMMENDATIONS_DAILY_BATCH_SIZE;

  // Oversample: muitos usuários são filtrados (plano, perfil, cache fresco).
  // `toProcess` ainda é limitado a `limit` mais abaixo.
  const users = await prisma.user.findMany({
    where: { isBlocked: false },
    select: {
      id: true,
      email: true,
      plan: true,
      isInfluencer: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit * 3,
  });

  const eligible = users.filter((u) =>
    canUsePatientClinicalChat(u.plan, u.email, u.isInfluencer),
  );
  summary.skippedIneligible = Math.max(0, users.length - eligible.length);

  const toProcess: { id: string; email: string | null }[] = [];

  for (const user of eligible) {
    if (toProcess.length >= limit) break;

    const profile = await getClinicalProfileSnapshot(user.id);
    if (profile.topTags.length < RECOMMENDATIONS_DAILY_MIN_PROFILE_TAGS) {
      summary.skippedNoProfile += 1;
      continue;
    }

    const fingerprint = clinicalProfileFingerprint(profile);
    const meta = await getCachedRecommendationsMeta(user.id);
    if (meta) {
      const ageMs = Date.now() - meta.generatedAt.getTime();
      if (meta.profileFingerprint === fingerprint && ageMs < RECOMMENDATIONS_DAILY_MIN_REFRESH_MS) {
        summary.skippedFresh += 1;
        continue;
      }
    }

    toProcess.push({ id: user.id, email: user.email });
  }

  summary.candidates = toProcess.length;

  await mapPool(toProcess, RECOMMENDATIONS_DAILY_CONCURRENCY, async (user) => {
    summary.processed += 1;
    try {
      const result = await runClinicalRecommendations(user.id, {
        refresh: true,
        source: "daily_cron",
      });
      if (result.ok) {
        summary.refreshed += 1;
      } else {
        summary.failed += 1;
        logger.warn("Cron indicações: falha por usuário", {
          feature: "daily-clinical-recommendations",
          userId: user.id,
          code: result.code,
        });
      }
    } catch (error) {
      summary.failed += 1;
      logger.error("Cron indicações: erro por usuário", {
        feature: "daily-clinical-recommendations",
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return summary;
}
