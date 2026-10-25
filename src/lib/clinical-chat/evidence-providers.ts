/**
 * Resolução de modos e provedores ativos para busca de evidência no chat clínico.
 *
 * Modos (CLINICAL_CHAT_EVIDENCE_PROVIDER):
 * - both (padrão): Consensus se CONSENSUS_API_KEY; Perplexity se PERPLEXITY_API_KEY
 *   (sem Consensus → equivale a Perplexity-only, sem erro)
 * - consensus | perplexity | pubmed: um provedor
 * - hybrid (fase C): PubMed (grátis) + fallback Perplexity
 */
import type { ClinicalChatCitation } from "@/lib/clinical-chat/citations";
import { dedupeCitations } from "@/lib/clinical-chat/citations";
import { searchConsensus } from "@/lib/clinical-chat/evidence-consensus";
import { searchPerplexity } from "@/lib/clinical-chat/evidence-perplexity";
import { searchPubMed } from "@/lib/clinical-chat/evidence-pubmed";

export type EvidenceProviderMode =
  | "both"
  | "consensus"
  | "perplexity"
  | "pubmed"
  | "hybrid";

const MIN_CITATIONS_BEFORE_FALLBACK = 3;
const MAX_QUERIES_PER_MESSAGE = 2;
const MAX_CITATIONS_COLLECT = 8;

export function getEvidenceProviderMode(): EvidenceProviderMode {
  const raw = process.env.CLINICAL_CHAT_EVIDENCE_PROVIDER?.trim().toLowerCase();
  if (
    raw === "consensus" ||
    raw === "perplexity" ||
    raw === "pubmed" ||
    raw === "hybrid"
  ) {
    return raw;
  }
  return "both";
}

export function isConsensusConfigured(): boolean {
  return Boolean(process.env.CONSENSUS_API_KEY?.trim());
}

export function isPerplexityConfigured(): boolean {
  return Boolean(process.env.PERPLEXITY_API_KEY?.trim());
}

/** PubMed E-utilities não exige chave; NCBI_API_KEY aumenta rate limit. */
export function isPubMedAvailable(): boolean {
  return process.env.CLINICAL_CHAT_PUBMED_ENABLED?.trim().toLowerCase() !== "false";
}

export function isClinicalEvidenceSearchAvailable(): boolean {
  const mode = getEvidenceProviderMode();
  switch (mode) {
    case "consensus":
      return isConsensusConfigured();
    case "perplexity":
      return isPerplexityConfigured();
    case "pubmed":
      return isPubMedAvailable();
    case "hybrid":
      return isPubMedAvailable() || isPerplexityConfigured();
    case "both":
    default:
      return isConsensusConfigured() || isPerplexityConfigured();
  }
}

/** Provedores efetivos no modo `both` (para logs/UI futura). */
export function getActiveEvidenceProviderLabels(): string[] {
  const mode = getEvidenceProviderMode();
  const labels: string[] = [];
  if (mode === "pubmed" || mode === "hybrid") {
    if (isPubMedAvailable()) labels.push("pubmed");
  }
  if (mode === "consensus" || (mode === "both" && isConsensusConfigured())) {
    labels.push("consensus");
  }
  if (
    mode === "perplexity" ||
    mode === "hybrid" ||
    (mode === "both" && isPerplexityConfigured())
  ) {
    labels.push("perplexity");
  }
  return labels;
}

async function collectForQuery(
  mode: EvidenceProviderMode,
  query: string,
): Promise<ClinicalChatCitation[]> {
  const collected: ClinicalChatCitation[] = [];

  const runConsensus =
    mode === "consensus" || (mode === "both" && isConsensusConfigured());
  const runPubMed =
    (mode === "pubmed" || mode === "hybrid") && isPubMedAvailable();
  const runPerplexity =
    mode === "perplexity" ||
    (mode === "both" && isPerplexityConfigured()) ||
    (mode === "hybrid" && isPerplexityConfigured());

  if (runPubMed) {
    collected.push(...(await searchPubMed(query)));
  }

  if (runConsensus) {
    collected.push(...(await searchConsensus(query)));
  }

  const needsPerplexityFallback =
    runPerplexity &&
    (mode === "perplexity" ||
      mode === "hybrid" ||
      (mode === "both" && !isConsensusConfigured()) ||
      dedupeCitations(collected).length < MIN_CITATIONS_BEFORE_FALLBACK);

  if (needsPerplexityFallback) {
    collected.push(...(await searchPerplexity(query)));
  }

  return collected;
}

/**
 * Orquestra buscas para queries anonimizadas (chat ou indicações).
 */
export async function searchClinicalEvidence(
  searchQueries: string[],
  options?: { maxQueries?: number; maxCitations?: number },
): Promise<ClinicalChatCitation[]> {
  if (!isClinicalEvidenceSearchAvailable() || searchQueries.length === 0) {
    return [];
  }

  const maxQueries = options?.maxQueries ?? MAX_QUERIES_PER_MESSAGE;
  const maxCitations = options?.maxCitations ?? MAX_CITATIONS_COLLECT;
  const mode = getEvidenceProviderMode();
  const collected: ClinicalChatCitation[] = [];

  for (const query of searchQueries.slice(0, maxQueries)) {
    collected.push(...(await collectForQuery(mode, query)));
    if (dedupeCitations(collected).length >= maxCitations) break;
  }

  return dedupeCitations(collected).slice(0, maxCitations);
}
