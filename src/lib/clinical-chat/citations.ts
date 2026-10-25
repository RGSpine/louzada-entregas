import { z } from "zod";
import { createHash } from "crypto";

export const clinicalChatCitationSchema = z.object({
  id: z.string().max(80),
  title: z.string().max(500),
  authors: z.string().max(400).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  url: z.string().url().max(2000),
  snippet: z.string().max(1200).nullable().optional(),
  source: z.enum(["consensus", "perplexity", "pubmed"]),
  studyType: z.string().max(120).nullable().optional(),
  journal: z.string().max(200).nullable().optional(),
});

export type ClinicalChatCitation = z.infer<typeof clinicalChatCitationSchema>;

export const clinicalChatCitationsArraySchema = z.array(clinicalChatCitationSchema).max(12);

export function sanitizeClinicalChatCitations(raw: unknown): ClinicalChatCitation[] {
  const parsed = clinicalChatCitationsArraySchema.safeParse(raw);
  if (!parsed.success) return [];
  return ensureUniqueCitationIds(parsed.data);
}

/** ID estável por URL — evita chaves React duplicadas (ex.: duas queries Perplexity). */
export function stableCitationId(item: Pick<ClinicalChatCitation, "source" | "url">): string {
  const hash = createHash("sha256")
    .update(`${item.source}|${item.url.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `${item.source}-${hash}`;
}

export function ensureUniqueCitationIds(items: ClinicalChatCitation[]): ClinicalChatCitation[] {
  return items.map((item) => ({
    ...item,
    id: stableCitationId(item),
  }));
}

export function dedupeCitations(items: ClinicalChatCitation[]): ClinicalChatCitation[] {
  const seen = new Set<string>();
  const out: ClinicalChatCitation[] = [];
  for (const item of items) {
    const key = item.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, id: stableCitationId(item) });
    if (out.length >= 10) break;
  }
  return out;
}

export function formatEvidenceBlockForPrompt(citations: ClinicalChatCitation[]): string {
  if (citations.length === 0) {
    return "(Nenhuma referência externa recuperada — responda só com o prontuário.)";
  }
  return citations
    .map((c, i) => {
      const idx = i + 1;
      const authors = c.authors?.trim() ? `Autores: ${c.authors}. ` : "";
      const year = c.year ? `Ano: ${c.year}. ` : "";
      const journal = c.journal?.trim() ? `Veículo: ${c.journal}. ` : "";
      const study = c.studyType?.trim() ? `Tipo: ${c.studyType}. ` : "";
      const snippet = c.snippet?.trim() ? `Trecho: ${c.snippet}` : "";
      return `[${idx}] (${c.source}) ${c.title}. ${authors}${year}${journal}${study}URL: ${c.url}. ${snippet}`.trim();
    })
    .join("\n\n");
}
