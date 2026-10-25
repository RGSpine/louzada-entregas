/**
 * Cache semântico R0 (Fase B) — só FAQ/produto sem PHI.
 * Similaridade local por trigramas (sem embedding pago); Redis opcional.
 */

import { getRedis } from "@/lib/redis";
import { normalizeCommandText } from "@/lib/scheduling-command-terms";
import { logger } from "@/lib/logger";
import { getCanonicalFaqSeedEntries } from "@/lib/b2c/canonical-faq";
import { logAiUsage } from "@/lib/ai-usage";

export const SEMANTIC_CACHE_THRESHOLD = 0.9;
const REDIS_KEY = "b2c:semantic_cache:r0:v1";
const MAX_DYNAMIC_ENTRIES = 120;
const TTL_SECONDS = 60 * 60 * 24 * 21; // 21 dias

export type SemanticCacheHit = {
  reply: string;
  score: number;
  source: "seed" | "redis";
  intent: string;
  matchedQuery: string;
};

type CacheEntry = {
  queryNorm: string;
  reply: string;
  intent: string;
  /** Contagens de trigramas serializadas. */
  vector: Record<string, number>;
  createdAt: number;
};

function trigramVector(normalized: string): Map<string, number> {
  const m = new Map<string, number>();
  const s = normalized.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 3) {
    if (s) m.set(s, 1);
    return m;
  }
  for (let i = 0; i <= s.length - 3; i++) {
    const g = s.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function vectorToRecord(v: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of v) out[k] = n;
  return out;
}

function recordToVector(r: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(r));
}

/** Cosseno entre bags de trigramas — exportado para testes. */
export function cosineTrigramSimilarity(a: string, b: string): number {
  const va = trigramVector(normalizeCommandText(a));
  const vb = trigramVector(normalizeCommandText(b));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of va) na += v * v;
  for (const [k, v] of vb) {
    nb += v * v;
    const u = va.get(k);
    if (u) dot += u * v;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function bestMatch(
  queryNorm: string,
  entries: CacheEntry[],
): { entry: CacheEntry; score: number } | null {
  let best: { entry: CacheEntry; score: number } | null = null;
  for (const entry of entries) {
    const score = cosineTrigramSimilarity(queryNorm, entry.queryNorm);
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }
  return best;
}

function seedEntries(): CacheEntry[] {
  const now = Date.now();
  return getCanonicalFaqSeedEntries().map((seed) => {
    const queryNorm = normalizeCommandText(seed.query);
    return {
      queryNorm,
      reply: seed.reply,
      intent: seed.intent,
      vector: vectorToRecord(trigramVector(queryNorm)),
      createdAt: now,
    };
  });
}

async function loadDynamicEntries(): Promise<CacheEntry[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get<CacheEntry[] | string>(REDIS_KEY);
    if (!raw) return [];
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as CacheEntry[];
      return Array.isArray(parsed) ? parsed : [];
    }
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    logger.warn("semantic-cache: falha ao ler Redis", {
      feature: "b2c-semantic-cache",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function saveDynamicEntries(entries: CacheEntry[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const trimmed = entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_DYNAMIC_ENTRIES);
    await redis.set(REDIS_KEY, trimmed, { ex: TTL_SECONDS });
  } catch (error) {
    logger.warn("semantic-cache: falha ao gravar Redis", {
      feature: "b2c-semantic-cache",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Busca resposta R0 com similaridade > 0.90 (seed + Redis).
 * Nunca usa texto clínico do paciente — só FAQ/produto.
 */
export async function searchSemanticCache(
  userText: string,
): Promise<SemanticCacheHit | null> {
  const queryNorm = normalizeCommandText(userText);
  if (queryNorm.length < 8) return null;

  const seeds = seedEntries();
  const dynamic = await loadDynamicEntries();
  const pooled = [...seeds, ...dynamic];
  const best = bestMatch(queryNorm, pooled);
  if (!best || best.score < SEMANTIC_CACHE_THRESHOLD) return null;

  const isSeed = seeds.some((s) => s.queryNorm === best.entry.queryNorm);

  logAiUsage({
    service: "semantic_cache_hit",
    model: "none",
    surface: "patient",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    meta: {
      score: Number(best.score.toFixed(4)),
      intent: best.entry.intent,
      source: isSeed ? "seed" : "redis",
    },
  });

  return {
    reply: best.entry.reply,
    score: best.score,
    source: isSeed ? "seed" : "redis",
    intent: best.entry.intent,
    matchedQuery: best.entry.queryNorm,
  };
}

/**
 * Persiste paráfrase R0 (FAQ/produto) no Redis — sem PHI.
 */
export async function putSemanticCache(input: {
  userText: string;
  reply: string;
  intent: string;
}): Promise<void> {
  const queryNorm = normalizeCommandText(input.userText);
  const reply = input.reply.trim().slice(0, 2_000);
  if (queryNorm.length < 8 || reply.length < 20) return;

  // Não cachear respostas que parecem lista pessoal de tarefas/horários.
  if (
    /pendências:|seu próximo compromisso|encontrei estes horários/i.test(reply)
  ) {
    return;
  }

  const entry: CacheEntry = {
    queryNorm,
    reply,
    intent: input.intent.slice(0, 64),
    vector: vectorToRecord(trigramVector(queryNorm)),
    createdAt: Date.now(),
  };

  const existing = await loadDynamicEntries();
  const withoutDup = existing.filter((e) => e.queryNorm !== queryNorm);
  withoutDup.unshift(entry);
  await saveDynamicEntries(withoutDup);
}
