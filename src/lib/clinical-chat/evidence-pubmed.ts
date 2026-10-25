/**
 * Ester (PubMed / NCBI E-utilities) — papers gratuitos, sem PII nas queries.
 *
 * Fluxo: esearch (PMIDs) → esummary (metadados JSON) → ClinicalChatCitation
 * Docs: https://www.ncbi.nlm.nih.gov/home/develop/api/
 *
 * Env opcional:
 * - NCBI_API_KEY — aumenta rate limit (grátis em account settings)
 * - NCBI_TOOL_NAME — identificador da app (padrão: aievolui)
 * - NCBI_CONTACT_EMAIL — e-mail de contato (recomendado pelo NCBI)
 * - CLINICAL_CHAT_PUBMED_ENABLED=false — desliga PubMed
 * - CLINICAL_CHAT_PUBMED_MAX_RESULTS=5
 * - CLINICAL_CHAT_PUBMED_YEAR_MIN=2010 — exclui papers antigos
 *
 * Ativar no chat: CLINICAL_CHAT_EVIDENCE_PROVIDER=pubmed | hybrid
 * (modo `both` padrão ainda não chama PubMed — use hybrid quando validar)
 */
import { logger } from "@/lib/logger";
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import { getCachedEvidence, setCachedEvidence } from "@/lib/clinical-chat/evidence-cache";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

type ESearchResponse = {
  esearchresult?: {
    idlist?: string[];
    count?: string;
  };
};

type ESummaryAuthor = { name?: string };
type ESummaryRecord = {
  uid?: string;
  title?: string;
  authors?: ESummaryAuthor[];
  source?: string;
  pubdate?: string;
  epubdate?: string;
  sortpubdate?: string;
  pubtype?: string[];
  elocationid?: string;
};

type ESummaryResponse = {
  result?: Record<string, ESummaryRecord | string[] | undefined> & {
    uids?: string[];
  };
};

function pubmedConfig() {
  return {
    apiKey: process.env.NCBI_API_KEY?.trim() || "",
    tool: process.env.NCBI_TOOL_NAME?.trim() || "aievolui",
    email: process.env.NCBI_CONTACT_EMAIL?.trim() || "",
    maxResults: Math.min(
      10,
      Math.max(1, parseInt(process.env.CLINICAL_CHAT_PUBMED_MAX_RESULTS ?? "5", 10) || 5),
    ),
    yearMin: parseInt(process.env.CLINICAL_CHAT_PUBMED_YEAR_MIN ?? "2010", 10) || 2010,
  };
}

function appendNcbiParams(params: URLSearchParams): void {
  const { apiKey, tool, email } = pubmedConfig();
  if (apiKey) params.set("api_key", apiKey);
  if (tool) params.set("tool", tool);
  if (email) params.set("email", email);
}

/** Monta termo PubMed: humanos + revisão/RCT quando possível + recência. */
export function buildPubMedQueryTerm(clinicalQuery: string): string {
  const q = clinicalQuery.trim().slice(0, 300);
  const { yearMin } = pubmedConfig();
  const filters = [
    `(${q})`,
    "(humans[MeSH Terms])",
    `${yearMin}:3000[dp]`,
    "(review[pt] OR randomized controlled trial[pt] OR meta-analysis[pt] OR guideline[pt])",
  ];
  return filters.join(" AND ");
}

function parsePubYear(record: ESummaryRecord): number | null {
  const raw = record.sortpubdate || record.epubdate || record.pubdate || "";
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

function formatAuthors(authors?: ESummaryAuthor[]): string | null {
  if (!authors?.length) return null;
  const names = authors
    .map((a) => a.name?.trim())
    .filter((n): n is string => Boolean(n))
    .slice(0, 4);
  if (names.length === 0) return null;
  if (authors.length > 4) return `${names.join(", ")}, et al.`;
  return names.join(", ");
}

function studyTypeFromPubTypes(pubtype?: string[]): string | null {
  if (!pubtype?.length) return null;
  const joined = pubtype.join(", ").toLowerCase();
  if (joined.includes("meta-analysis")) return "meta-analysis";
  if (joined.includes("systematic review")) return "systematic review";
  if (joined.includes("randomized controlled")) return "RCT";
  if (joined.includes("review")) return "review";
  if (joined.includes("guideline")) return "guideline";
  return pubtype[0] ?? null;
}

async function pubmedEsearch(term: string): Promise<string[]> {
  const { maxResults } = pubmedConfig();
  const params = new URLSearchParams({
    db: "pubmed",
    term,
    retmode: "json",
    retmax: String(maxResults),
    sort: "relevance",
  });
  appendNcbiParams(params);

  const res = await fetch(`${EUTILS_BASE}/esearch.fcgi?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`PubMed esearch HTTP ${res.status}`);
  }
  const data = (await res.json()) as ESearchResponse;
  return data.esearchresult?.idlist ?? [];
}

async function pubmedEsummary(pmids: string[]): Promise<ESummaryRecord[]> {
  if (pmids.length === 0) return [];

  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "json",
  });
  appendNcbiParams(params);

  const res = await fetch(`${EUTILS_BASE}/esummary.fcgi?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`PubMed esummary HTTP ${res.status}`);
  }
  const data = (await res.json()) as ESummaryResponse;
  const uids = data.result?.uids ?? [];
  return uids
    .map((uid) => {
      const rec = data.result?.[uid];
      return rec && typeof rec === "object" && "uid" in rec ? rec : null;
    })
    .filter((r): r is ESummaryRecord => r != null);
}

/**
 * Busca papers no PubMed e normaliza para o formato de citações do chat.
 */
export async function searchPubMed(clinicalQuery: string): Promise<ClinicalChatCitation[]> {
  if (process.env.CLINICAL_CHAT_PUBMED_ENABLED?.trim().toLowerCase() === "false") {
    return [];
  }

  const cacheKey = clinicalQuery.trim().toLowerCase();
  const cached = getCachedEvidence("pubmed", cacheKey);
  if (cached) return cached;

  const term = buildPubMedQueryTerm(clinicalQuery);

  try {
    const pmids = await pubmedEsearch(term);
    if (pmids.length === 0) {
      logger.info("PubMed: nenhum PMID", { feature: "clinical-chat", term: term.slice(0, 120) });
      setCachedEvidence("pubmed", cacheKey, []);
      return [];
    }

    const records = await pubmedEsummary(pmids);
    const citations: ClinicalChatCitation[] = [];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      const pmid = rec.uid || pmids[i];
      if (!pmid) continue;
      const title = (rec.title || "Artigo PubMed").replace(/\s+/g, " ").trim();
      citations.push({
        id: `pubmed-${pmid}`,
        title: title.slice(0, 500),
        authors: formatAuthors(rec.authors),
        year: parsePubYear(rec),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        snippet: rec.source ? `Publicado em ${rec.source}.`.slice(0, 800) : null,
        source: "pubmed",
        studyType: studyTypeFromPubTypes(rec.pubtype),
        journal: rec.source?.slice(0, 200) ?? null,
      });
    }

    setCachedEvidence("pubmed", cacheKey, citations);
    return citations;
  } catch (err) {
    logger.warn("PubMed exceção", {
      feature: "clinical-chat",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
