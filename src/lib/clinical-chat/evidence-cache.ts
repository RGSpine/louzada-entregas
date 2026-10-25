/**
 * Cache em memória por instância para buscas de evidência (TTL 7 dias).
 * Com Upstash no futuro pode migrar para Redis.
 */
import { createHash } from "crypto";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";

type CacheEntry = {
  citations: ClinicalChatCitation[];
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(provider: string, query: string): string {
  const norm = query.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`${provider}:${norm}`).digest("hex");
}

export function getCachedEvidence(
  provider: string,
  query: string,
): ClinicalChatCitation[] | null {
  const key = cacheKey(provider, query);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.citations;
}

export function setCachedEvidence(
  provider: string,
  query: string,
  citations: ClinicalChatCitation[],
): void {
  const key = cacheKey(provider, query);
  store.set(key, { citations, expiresAt: Date.now() + TTL_MS });
}
