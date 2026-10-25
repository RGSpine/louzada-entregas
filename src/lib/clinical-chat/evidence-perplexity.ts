/**
 * Perplexity Sonar — diretrizes e contexto web com citações.
 * https://docs.perplexity.ai/docs/getting-started/pricing
 */
import { logger } from "@/lib/logger";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import { getCachedEvidence, setCachedEvidence } from "@/lib/clinical-chat/evidence-cache";

const PERPLEXITY_BASE = "https://api.perplexity.ai";

type PerplexitySearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
};

export async function searchPerplexity(query: string): Promise<ClinicalChatCitation[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (!apiKey) return [];

  const cached = getCachedEvidence("perplexity", query);
  if (cached) return cached;

  const model = process.env.PERPLEXITY_SONAR_MODEL?.trim() || "sonar";

  try {
    const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You retrieve clinical evidence. Answer briefly in English with numbered facts only. Do not include patient identifiers.",
          },
          {
            role: "user",
            content: `Summarize peer-reviewed or guideline-level evidence for: ${query}. Focus on human clinical studies and official guidelines.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(35_000),
    });

    if (!res.ok) {
      logger.warn("Perplexity chat falhou", {
        feature: "clinical-chat",
        status: res.status,
      });
      return [];
    }

    const data = (await res.json()) as {
      citations?: string[];
      search_results?: PerplexitySearchResult[];
    };

    const fromSearch = (data.search_results ?? [])
      .filter((s) => s.url?.startsWith("http"))
      .slice(0, 5)
      .map((s, i) => ({
        id: `perplexity-sr-${i}`,
        title: (s.title || s.url || "Fonte web").slice(0, 500),
        authors: null,
        year: s.date ? parseInt(s.date.slice(0, 4), 10) || null : null,
        url: s.url!,
        snippet: s.snippet?.slice(0, 800) ?? null,
        source: "perplexity" as const,
        studyType: null,
        journal: null,
      }));

    if (fromSearch.length > 0) {
      setCachedEvidence("perplexity", query, fromSearch);
      return fromSearch;
    }

    const fromCitations = (data.citations ?? [])
      .filter((u) => typeof u === "string" && u.startsWith("http"))
      .slice(0, 5)
      .map((url, i) => ({
        id: `perplexity-c-${i}`,
        title: url.replace(/^https?:\/\//, "").slice(0, 120),
        authors: null,
        year: null,
        url,
        snippet: null,
        source: "perplexity" as const,
        studyType: null,
        journal: null,
      }));

    setCachedEvidence("perplexity", query, fromCitations);
    return fromCitations;
  } catch (err) {
    logger.warn("Perplexity exceção", {
      feature: "clinical-chat",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
