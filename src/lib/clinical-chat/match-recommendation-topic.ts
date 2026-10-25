/**
 * Correlação artigo ↔ tag do Perfil Clínico (ramos guarda-chuva).
 * Usa título/snippet (+ query opcional) e sinônimos PT→EN acadêmicos.
 */

function removeAccents(value: string): string {
  // Combina diacríticos (U+0300–U+036F) — compatível com target ES5 (sem \p{M}).
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeHaystack(value: string): string {
  return removeAccents(value.toLowerCase()).replace(/[^a-z0-9\s-]/g, " ");
}

/** Tokens úteis da tag (ignora conectores curtos). */
function tagTokens(tag: string): string[] {
  return normalizeHaystack(tag)
    .split(/[\s/_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
}

/**
 * Sinônimos em inglês (e variantes) por guarda-chuva PT.
 * Chave = tag normalizada sem acento (lowercase).
 */
const UMBRELLA_EN_SYNONYMS: Record<string, string[]> = {
  tendinopatia: ["tendinopathy", "tendinitis", "tendinosis", "tendon", "achilles", "patellar tendon"],
  lombalgia: ["low back pain", "lumbar", "lumbago", "sciatica", "lumbosacral"],
  "sindrome miofascial": ["myofascial", "trigger point", "myofascial pain"],
  "lesao ligamentar": ["ligament", "sprain", "acl", "mcl", "ankle sprain"],
  "pos-operatorio": ["postoperative", "post-operative", "post surgery", "after surgery", "rehab after"],
  "pos operatorio": ["postoperative", "post-operative", "post surgery"],
  artropatia: ["arthropathy", "osteoarthritis", "arthritis", "joint disease"],
  bursite: ["bursitis"],
  "fasciopatia plantar": ["plantar fasciitis", "plantar fascia"],
  neuropatia: ["neuropathy", "neuropathic"],
  "capsulite adesiva": ["frozen shoulder", "adhesive capsulitis"],
  "lesao manguito rotador": ["rotator cuff", "supraspinatus"],
  "sindrome patelofemoral": ["patellofemoral", "anterior knee pain"],
  "lesao muscular": ["muscle strain", "muscle injury", "hamstring strain"],
  fibromialgia: ["fibromyalgia"],
  depressao: ["depression", "major depressive", "depressive disorder"],
  ansiedade: ["anxiety", "generalized anxiety"],
  "transtorno de ansiedade": ["anxiety disorder", "gad"],
  diabetes: ["diabetes", "type 2 diabetes", "t2dm", "glycemic"],
  hipertensao: ["hypertension", "blood pressure", "antihypertensive"],
  obesidade: ["obesity", "overweight", "bariatric"],
  asma: ["asthma"],
  "doenca periodontal": ["periodontal", "periodontitis"],
  carie: ["dental caries", "tooth decay"],
};

function synonymsForTag(tag: string): string[] {
  const key = normalizeHaystack(tag).replace(/\s+/g, " ").trim();
  return UMBRELLA_EN_SYNONYMS[key] ?? [];
}

function scoreTagAgainstText(tag: string, text: string): number {
  const hay = normalizeHaystack(text);
  if (!hay) return 0;

  let score = 0;
  const tokens = tagTokens(tag);
  for (const token of tokens) {
    if (hay.includes(token)) score += token.length >= 8 ? 4 : 3;
  }

  for (const syn of synonymsForTag(tag)) {
    const s = normalizeHaystack(syn);
    if (s && hay.includes(s)) {
      score += s.includes(" ") ? 6 : 5;
    }
  }

  return score;
}

/**
 * Escolhe a tag do perfil que melhor casa com o artigo (título/snippet).
 * Query é só desempate leve — nunca sobrescreve um match claro no título.
 */
export function matchRecommendationTopic(
  citation: { title: string; snippet?: string | null },
  profileTags: string[],
  queryHint?: string | null,
): string | null {
  if (profileTags.length === 0) return null;

  const articleBlob = [citation.title, citation.snippet ?? ""].join(" \n ");
  let bestTag: string | null = null;
  let bestArticleScore = 0;
  let bestCombinedScore = 0;

  for (const tag of profileTags) {
    const articleScore = scoreTagAgainstText(tag, articleBlob);
    const queryScore = queryHint ? scoreTagAgainstText(tag, queryHint) * 0.35 : 0;
    const combined = articleScore + queryScore;

    if (
      articleScore > bestArticleScore ||
      (articleScore === bestArticleScore && combined > bestCombinedScore)
    ) {
      bestArticleScore = articleScore;
      bestCombinedScore = combined;
      bestTag = tag;
    }
  }

  // Exige evidência no artigo; query sozinha não rotula.
  if (bestArticleScore < 3) return null;
  return bestTag;
}

export function attachMatchedTopics<T extends { title: string; snippet?: string | null }>(
  citations: T[],
  queries: string[],
  profileTags: string[],
): Array<T & { matchedTopic: string | null }> {
  return citations.map((citation, index) => {
    // Query associada por rodízio só como desempate — o título do artigo manda.
    const queryByIndex = queries.length > 0 ? (queries[index % queries.length] ?? null) : null;
    return {
      ...citation,
      matchedTopic: matchRecommendationTopic(citation, profileTags, queryByIndex),
    };
  });
}

/** Fallback determinístico: 1 query acadêmica por tag do top perfil (sem LLM). */
export function buildFallbackQueriesFromProfileTags(
  tags: string[],
  maxQueries: number,
): string[] {
  const out: string[] = [];
  for (const tag of tags.slice(0, maxQueries)) {
    const syns = synonymsForTag(tag);
    const primary = syns[0] ?? normalizeHaystack(tag);
    if (primary.length < 4) continue;
    out.push(`${primary} clinical management systematic review guidelines`);
  }
  return out;
}
