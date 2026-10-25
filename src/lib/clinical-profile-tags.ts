/**
 * Perfil Clínico (Estatísticas): resolução de tags por evolução + agregação.
 *
 * Fluxo ideal (founder):
 * 1. Em qualquer evolução, reconhecer diagnóstico / atualização do caso
 * 2. Tratar sem alterar o texto da evolução
 * 3. Persistir termo guarda-chuva em Evolution.tags
 * 4. Agregar ramos clínicos familiares no gráfico do Perfil Clínico
 */

import {
  extractTagFromMeta,
  normalizeToUmbrella,
  UMBRELLA_TERMS,
} from "@/lib/clinical-taxonomy";

export type ClinicalProfileTag = {
  tag: string;
  count: number;
};

export type ClinicalProfileSnapshot = {
  topTags: ClinicalProfileTag[];
  totalTags: number;
  /** Foco do mês civil atual; fallback para o top geral se o mês estiver vazio. */
  mostFrequentTag: string | null;
  monthTagCount: number;
};

export type ResolveEvolutionClinicalTagsInput = {
  clinicalMeta?: Record<string, string | undefined> | null;
  patientDiagnosis?: string | null;
  storedPatientDiagnosis?: string | null;
  /** Conteúdo da evolução — só usado se as fontes estruturadas falharem. */
  evolutionContent?: string | null;
};

const CONTENT_SECTION_RE =
  /(?:^|\n)\s*(?:diagn[oó]stico|conclus[aã]o|impress[aã]o\s+diagn[oó]stica|hip[oó]tese\s+diagn[oó]stica|cid)\s*[:：]?\s*([\s\S]{0,400})/gi;

/** Chaves do mapa com >= 5 chars, maiores primeiro — evita falsos positivos no texto livre. */
function sortedUmbrellaKeys(): string[] {
  return Object.keys(UMBRELLA_TERMS)
    .filter((k) => k.length >= 5)
    .sort((a, b) => b.length - a.length);
}

function removeAccentsLocal(value: string): string {
  // Combina diacríticos (U+0300–U+036F) — compatível com target ES5 (sem \p{M}).
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Varre trechos de diagnóstico/conclusão (ou o texto inteiro) em busca de
 * termos do mapa guarda-chuva. Não altera o conteúdo — só identifica.
 */
export function extractUmbrellaFromEvolutionContent(
  content: string | null | undefined,
): string | null {
  if (!content || content.trim().length < 8) return null;

  const sections: string[] = [];
  for (const match of content.matchAll(CONTENT_SECTION_RE)) {
    if (match[1]?.trim()) sections.push(match[1].trim());
  }
  const haystacks =
    sections.length > 0 ? sections : [content.slice(0, 2500)];

  const keys = sortedUmbrellaKeys();
  for (const hay of haystacks) {
    const lower = removeAccentsLocal(hay.toLowerCase());
    for (const key of keys) {
      if (lower.includes(key)) {
        return UMBRELLA_TERMS[key] ?? null;
      }
    }
  }

  return null;
}

/**
 * Cascata de identificação do ramo clínico (1 tag guarda-chuva por evolução).
 * Ordem: clinicalMeta → diagnóstico da sessão → texto da evolução → diagnóstico persistido.
 */
export function resolveEvolutionClinicalTags(
  input: ResolveEvolutionClinicalTagsInput,
): string[] {
  const fromMeta = extractTagFromMeta(input.clinicalMeta ?? undefined);
  if (fromMeta.length > 0) return fromMeta;

  if (input.patientDiagnosis?.trim()) {
    const tag = normalizeToUmbrella(input.patientDiagnosis);
    if (tag) return [tag];
  }

  const fromContent = extractUmbrellaFromEvolutionContent(input.evolutionContent);
  if (fromContent) return [fromContent];

  if (input.storedPatientDiagnosis?.trim()) {
    const tag = normalizeToUmbrella(input.storedPatientDiagnosis);
    if (tag) return [tag];
  }

  return [];
}

/**
 * Diagnóstico sugerido para sincronizar Patient.diagnosis sem tocar no texto
 * da evolução: prioriza clinicalMeta.diagnostico/quadro/patologia.
 */
export function resolveCaseDefinitionLabel(
  clinicalMeta?: Record<string, string | undefined> | null,
  patientDiagnosis?: string | null,
): string | null {
  if (clinicalMeta) {
    for (const key of ["diagnostico", "quadro", "patologia"] as const) {
      const raw = clinicalMeta[key]?.trim();
      if (!raw) continue;
      const umbrella = normalizeToUmbrella(raw);
      if (umbrella) return umbrella;
    }
  }
  if (patientDiagnosis?.trim()) {
    return normalizeToUmbrella(patientDiagnosis);
  }
  return null;
}

export function effectiveTagsForEvolution(row: {
  tags?: string[] | null;
  clinicalMeta?: unknown;
  content?: string | null;
}): string[] {
  if (Array.isArray(row.tags) && row.tags.length > 0) {
    const out: string[] = [];
    for (const tag of row.tags) {
      const normalized = normalizeToUmbrella(tag);
      if (normalized && normalized.length >= 3) out.push(normalized);
    }
    if (out.length > 0) return out;
  }

  const meta =
    row.clinicalMeta && typeof row.clinicalMeta === "object" && !Array.isArray(row.clinicalMeta)
      ? (row.clinicalMeta as Record<string, string | undefined>)
      : undefined;

  return resolveEvolutionClinicalTags({
    clinicalMeta: meta,
    evolutionContent: row.content,
  });
}

function startOfMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function aggregateTagFrequency(tags: string[]): {
  topTags: ClinicalProfileTag[];
  totalTags: number;
  mostFrequentTag: string | null;
} {
  if (tags.length === 0) {
    return { topTags: [], totalTags: 0, mostFrequentTag: null };
  }

  const tagFrequency: Record<string, number> = {};
  const tagDisplay: Record<string, string> = {};

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    tagFrequency[lower] = (tagFrequency[lower] ?? 0) + 1;
    tagDisplay[lower] = tag;
  }

  const topTags = Object.entries(tagFrequency)
    .map(([lower, count]) => ({ tag: tagDisplay[lower]!, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 5);

  return {
    topTags,
    totalTags: tags.length,
    mostFrequentTag: topTags[0]?.tag ?? null,
  };
}

export type EvolutionProfileRow = {
  tags?: string[] | null;
  clinicalMeta?: unknown;
  content?: string | null;
  date: Date;
};

/**
 * Agrega ramos clínicos familiares para o gráfico do Perfil Clínico.
 * - Top 5 / total: todo o histórico (portfólio de atuação)
 * - Foco do mês: apenas evoluções do mês civil UTC atual
 */
export function aggregateClinicalProfile(
  evolutions: EvolutionProfileRow[],
  now = new Date(),
): ClinicalProfileSnapshot {
  const monthStart = startOfMonthUtc(now);
  const allTags: string[] = [];
  const monthTags: string[] = [];

  for (const evo of evolutions) {
    const tags = effectiveTagsForEvolution(evo);
    if (tags.length === 0) continue;
    allTags.push(...tags);
    if (evo.date >= monthStart) {
      monthTags.push(...tags);
    }
  }

  const overall = aggregateTagFrequency(allTags);
  const month = aggregateTagFrequency(monthTags);

  return {
    topTags: overall.topTags,
    totalTags: overall.totalTags,
    mostFrequentTag: month.mostFrequentTag ?? overall.mostFrequentTag,
    monthTagCount: month.totalTags,
  };
}
