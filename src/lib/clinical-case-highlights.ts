/**
 * Tópicos principais do caso clínico (nível paciente), persistidos em Patient.clinicalCaseHighlights.
 */

import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

export const CLINICAL_CASE_HIGHLIGHTS_VERSION = 1 as const;

export const BULLET_MAX_LEN = 220;
export const BULLETS_MAX_COUNT = 15;
export const CLINICAL_SUMMARY_MAX_LEN = 1500;
const REJECTED_MAX_COUNT = 40;
const REJECTED_ITEM_MAX_LEN = 400;

export const clinicalCaseHighlightsStoredSchema = z.object({
  v: z.literal(CLINICAL_CASE_HIGHLIGHTS_VERSION),
  bullets: z.array(z.string().max(BULLET_MAX_LEN)).max(BULLETS_MAX_COUNT),
  /** ISO da última revisão manual do profissional (resumo e/ou tópicos). */
  userEditedAt: z.string().datetime().optional(),
  /** Tópicos/frases do resumo removidos pelo profissional — a IA nunca deve reintroduzi-los. */
  rejected: z.array(z.string().max(REJECTED_ITEM_MAX_LEN)).max(REJECTED_MAX_COUNT).optional(),
});

export type ClinicalCaseHighlightsStored = z.infer<typeof clinicalCaseHighlightsStoredSchema>;

export type ClinicalCaseHighlightsReviewMeta = {
  userEditedAt?: string;
  rejected: string[];
};

export function sanitizeClinicalCaseHighlights(
  stored: ClinicalCaseHighlightsStored
): ClinicalCaseHighlightsStored {
  const bullets = stored.bullets
    .map((b) => sanitizeText(b).slice(0, BULLET_MAX_LEN))
    .filter((b) => b.length > 0)
    .slice(0, BULLETS_MAX_COUNT);
  return {
    v: CLINICAL_CASE_HIGHLIGHTS_VERSION,
    bullets,
    ...(stored.userEditedAt ? { userEditedAt: stored.userEditedAt } : {}),
    ...(stored.rejected?.length ? { rejected: stored.rejected } : {}),
  };
}

/** Parse do Json do Prisma; retorna undefined se inválido ou sem bullets (para exibição). */
export function parseClinicalCaseHighlightsStored(
  raw: unknown
): ClinicalCaseHighlightsStored | undefined {
  const parsed = clinicalCaseHighlightsStoredSchema.safeParse(raw);
  if (!parsed.success || parsed.data.bullets.length === 0) {
    return undefined;
  }
  return sanitizeClinicalCaseHighlights(parsed.data);
}

/** Marca de revisão manual e itens rejeitados (válido mesmo com zero bullets). */
export function parseClinicalCaseHighlightsReviewMeta(raw: unknown): ClinicalCaseHighlightsReviewMeta {
  const parsed = clinicalCaseHighlightsStoredSchema.safeParse(raw);
  if (!parsed.success) return { rejected: [] };
  return {
    ...(parsed.data.userEditedAt ? { userEditedAt: parsed.data.userEditedAt } : {}),
    rejected: parsed.data.rejected ?? [],
  };
}

/**
 * Normaliza bullets vindos da IA e produz objeto persistível.
 * Retorna undefined se não houver bullets válidas após sanitização.
 */
export function buildClinicalCaseHighlightsFromBullets(
  bullets: string[]
): ClinicalCaseHighlightsStored | undefined {
  const stored = sanitizeClinicalCaseHighlights({
    v: CLINICAL_CASE_HIGHLIGHTS_VERSION,
    bullets,
  });
  if (stored.bullets.length === 0) {
    return undefined;
  }
  const revalidated = clinicalCaseHighlightsStoredSchema.safeParse(stored);
  if (!revalidated.success) {
    return undefined;
  }
  return revalidated.data;
}

function foldForCompare(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(foldForCompare(text).split(" ").filter((w) => w.length >= 3));
}

/** Mesmo item com outra redação: igualdade, inclusão (≥12 chars) ou Jaccard ≥ 0.6. */
export function isSameClinicalItem(a: string, b: string): boolean {
  const fa = foldForCompare(a);
  const fb = foldForCompare(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const [shorter, longer] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (shorter.length >= 12 && longer.includes(shorter)) return true;
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter) >= 0.6;
}

/** Remove itens que o profissional já rejeitou (mesmo reescritos pela IA). */
export function dropRejectedItems(items: string[], rejected: string[]): string[] {
  if (rejected.length === 0) return items;
  return items.filter((item) => !rejected.some((r) => isSameClinicalItem(item, r)));
}

export function splitSummarySentences(summary: string): string[] {
  return summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Revisão manual do profissional: calcula o que foi removido (tópicos e frases do resumo)
 * e acumula em `rejected`, para que regenerações automáticas não reintroduzam a alucinação.
 */
export function buildManualClinicalReview(args: {
  previousBullets: string[];
  previousSummary: string;
  previousRejected: string[];
  nextBullets: string[];
  nextSummary: string;
  editedAt: Date;
}): { stored: ClinicalCaseHighlightsStored; summary: string } {
  const nextBullets = args.nextBullets
    .map((b) => sanitizeText(b).trim().slice(0, BULLET_MAX_LEN))
    .filter(Boolean)
    .slice(0, BULLETS_MAX_COUNT);
  const summary = sanitizeText(args.nextSummary).trim().slice(0, CLINICAL_SUMMARY_MAX_LEN);
  const nextSentences = splitSummarySentences(summary);

  const removedBullets = args.previousBullets.filter(
    (prev) => !nextBullets.some((b) => isSameClinicalItem(prev, b)),
  );
  const removedSentences = splitSummarySentences(args.previousSummary).filter(
    (prev) => !nextSentences.some((s) => isSameClinicalItem(prev, s)),
  );

  const kept = args.previousRejected.filter(
    (r) =>
      !nextBullets.some((b) => isSameClinicalItem(r, b)) &&
      !nextSentences.some((s) => isSameClinicalItem(r, s)),
  );
  const rejected: string[] = [];
  for (const item of [...removedBullets, ...removedSentences, ...kept]) {
    const clean = sanitizeText(item).trim().slice(0, REJECTED_ITEM_MAX_LEN);
    if (clean && !rejected.some((r) => isSameClinicalItem(r, clean))) rejected.push(clean);
  }

  return {
    stored: {
      v: CLINICAL_CASE_HIGHLIGHTS_VERSION,
      bullets: nextBullets,
      userEditedAt: args.editedAt.toISOString(),
      ...(rejected.length ? { rejected: rejected.slice(0, REJECTED_MAX_COUNT) } : {}),
    },
    summary,
  };
}
