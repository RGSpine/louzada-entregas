import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

const reviewItem = z.string().max(400);

/** Itens que o paciente apagou nesta consulta — não voltam se o texto for reorganizado. */
export const consultationReviewSchema = z.object({
  userEditedAt: z.string().datetime().optional(),
  rejected: z.array(reviewItem).max(40).optional(),
});

/** Frases que o paciente apagou do panorama do mapa. Viaja no JSON da consulta mais recente. */
export const panoramaReviewSchema = z.object({
  userEditedAt: z.string().datetime().optional(),
  rejected: z.array(reviewItem).max(40).optional(),
});

export const consultationStructuredSchema = z.object({
  professionalName: z.string().max(200).nullable().optional(),
  specialty: z.string().max(200).nullable().optional(),
  recommendations: z.array(z.string().max(400)).max(12).default([]),
  attentionPoints: z.array(z.string().max(400)).max(12).default([]),
  orientations: z.array(z.string().max(400)).max(12).default([]),
  panoramaSnippet: z.string().max(2000).nullable().optional(),
  review: consultationReviewSchema.optional(),
  panoramaReview: panoramaReviewSchema.optional(),
});

export type ConsultationReviewMeta = {
  userEditedAt?: string;
  rejected: string[];
};

export type ConsultationStructured = {
  professionalName: string | null;
  specialty: string | null;
  recommendations: string[];
  attentionPoints: string[];
  orientations: string[];
  panoramaSnippet: string | null;
  review?: ConsultationReviewMeta;
  panoramaReview?: ConsultationReviewMeta;
};

export function sanitizeConsultationStructured(
  raw: unknown,
): ConsultationStructured {
  const parsed = consultationStructuredSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      professionalName: null,
      specialty: null,
      recommendations: [],
      attentionPoints: [],
      orientations: [],
      panoramaSnippet: null,
    };
  }
  const cleanList = (items: string[]) =>
    items
      .map((item) => sanitizeText(item).slice(0, 400))
      .filter(Boolean)
      .slice(0, 12);

  const review = cleanReview(parsed.data.review);
  const panoramaReview = cleanReview(parsed.data.panoramaReview);
  return {
    professionalName: parsed.data.professionalName
      ? sanitizeText(parsed.data.professionalName).slice(0, 200)
      : null,
    specialty: parsed.data.specialty
      ? sanitizeText(parsed.data.specialty).slice(0, 200)
      : null,
    recommendations: cleanList(parsed.data.recommendations),
    attentionPoints: cleanList(parsed.data.attentionPoints),
    orientations: cleanList(parsed.data.orientations),
    panoramaSnippet: parsed.data.panoramaSnippet
      ? sanitizeText(parsed.data.panoramaSnippet).slice(0, 2000)
      : null,
    ...(review ? { review } : {}),
    ...(panoramaReview ? { panoramaReview } : {}),
  };
}

function cleanReview(
  review: { userEditedAt?: string; rejected?: string[] } | undefined,
): ConsultationReviewMeta | undefined {
  if (!review) return undefined;
  const rejected = (review.rejected ?? [])
    .map((item) => sanitizeText(item).slice(0, 400))
    .filter(Boolean)
    .slice(0, 40);
  if (!review.userEditedAt && rejected.length === 0) return undefined;
  return {
    ...(review.userEditedAt ? { userEditedAt: review.userEditedAt } : {}),
    rejected,
  };
}

export function parseConsultationReviewMeta(raw: unknown): ConsultationReviewMeta {
  const parsed = consultationStructuredSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.review) return { rejected: [] };
  return {
    ...(parsed.data.review.userEditedAt
      ? { userEditedAt: parsed.data.review.userEditedAt }
      : {}),
    rejected: parsed.data.review.rejected ?? [],
  };
}

export function parsePanoramaReview(raw: unknown): ConsultationReviewMeta {
  const parsed = consultationStructuredSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.panoramaReview) return { rejected: [] };
  return {
    ...(parsed.data.panoramaReview.userEditedAt
      ? { userEditedAt: parsed.data.panoramaReview.userEditedAt }
      : {}),
    rejected: parsed.data.panoramaReview.rejected ?? [],
  };
}

export function parseStoredConsultationStructured(
  raw: unknown,
): ConsultationStructured {
  return sanitizeConsultationStructured(raw);
}
