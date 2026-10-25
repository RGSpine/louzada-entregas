/**
 * Consensus API — papers revisados por pares (pago).
 * https://docs.consensus.app/reference/v1_quick_search
 */
import { logger } from "@/lib/logger";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import { getCachedEvidence, setCachedEvidence } from "@/lib/clinical-chat/evidence-cache";

const CONSENSUS_BASE = "https://api.consensus.app";

type ConsensusPaper = {
  title?: string;
  authors?: string[];
  publish_year?: number;
  url?: string;
  abstract?: string;
  takeaway?: string;
  study_type?: string;
  journal_name?: string;
  doi?: string;
};

export async function searchConsensus(query: string): Promise<ClinicalChatCitation[]> {
  const apiKey = process.env.CONSENSUS_API_KEY?.trim();
  if (!apiKey) return [];

  const cached = getCachedEvidence("consensus", query);
  if (cached) return cached;

  const params = new URLSearchParams({
    query,
    medical_mode: "true",
    human: "true",
    exclude_preprints: "true",
  });

  try {
    const res = await fetch(`${CONSENSUS_BASE}/v1/quick_search?${params}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      logger.warn("Consensus quick_search falhou", {
        feature: "clinical-chat",
        status: res.status,
      });
      return [];
    }
    const data = (await res.json()) as { results?: ConsensusPaper[] };
    const citations: ClinicalChatCitation[] = (data.results ?? [])
      .slice(0, 5)
      .map((p, i) => {
        const url =
          p.url?.trim() ||
          (p.doi ? `https://doi.org/${p.doi}` : "") ||
          "https://consensus.app";
        const authors = Array.isArray(p.authors) ? p.authors.slice(0, 4).join(", ") : null;
        return {
          id: `consensus-${i}-${url.slice(-12)}`,
          title: (p.title || "Artigo sem título").slice(0, 500),
          authors,
          year: typeof p.publish_year === "number" ? p.publish_year : null,
          url,
          snippet: (p.takeaway || p.abstract || "").slice(0, 800) || null,
          source: "consensus" as const,
          studyType: p.study_type ?? null,
          journal: p.journal_name ?? null,
        };
      })
      .filter((c) => c.url.startsWith("http"));

    setCachedEvidence("consensus", query, citations);
    return citations;
  } catch (err) {
    logger.warn("Consensus exceção", {
      feature: "clinical-chat",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
