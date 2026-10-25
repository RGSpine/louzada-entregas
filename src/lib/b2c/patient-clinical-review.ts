/**
 * Correção manual do paciente: consulta captada, panorama e o que não deve voltar.
 */
import { sanitizeText } from "@/lib/sanitize";
import {
  dropRejectedItems,
  isSameClinicalItem,
  splitSummarySentences,
} from "@/lib/clinical-case-highlights";
import {
  parsePanoramaReview,
  type ConsultationReviewMeta,
  type ConsultationStructured,
} from "@/lib/b2c/consultation-structured";

const ITEM_MAX = 400;
const REJECTED_MAX = 40;

function cleanItem(value: string): string {
  return sanitizeText(value).trim().slice(0, ITEM_MAX);
}

function accumulateRejected(previous: string[], nextKept: string[], already: string[]): string[] {
  const removed = previous.filter((item) => !nextKept.some((kept) => isSameClinicalItem(item, kept)));
  const stillRejected = already.filter(
    (item) => !nextKept.some((kept) => isSameClinicalItem(item, kept)),
  );
  const rejected: string[] = [];
  for (const item of [...removed, ...stillRejected]) {
    const clean = cleanItem(item);
    if (clean && !rejected.some((saved) => isSameClinicalItem(saved, clean))) {
      rejected.push(clean);
    }
  }
  return rejected.slice(0, REJECTED_MAX);
}

export function buildPatientConsultationReview(args: {
  previous: ConsultationStructured;
  previousRejected: string[];
  nextExplanation: string;
  nextRecommendations: string[];
  nextAttentionPoints: string[];
  nextOrientations: string[];
  nextProfessionalName: string;
  nextSpecialty: string;
  panoramaReview?: ConsultationReviewMeta;
  editedAt: Date;
}): { explanation: string; structured: ConsultationStructured } {
  const explanation = sanitizeText(args.nextExplanation).trim().slice(0, 12_000);
  const recommendations = args.nextRecommendations.map(cleanItem).filter(Boolean).slice(0, 12);
  const attentionPoints = args.nextAttentionPoints.map(cleanItem).filter(Boolean).slice(0, 12);
  const orientations = args.nextOrientations.map(cleanItem).filter(Boolean).slice(0, 12);
  const professionalName = cleanItem(args.nextProfessionalName).slice(0, 200) || null;
  const specialty = cleanItem(args.nextSpecialty).slice(0, 200) || null;

  const previousItems = [
    ...splitSummarySentences(args.previous.panoramaSnippet ?? ""),
    ...args.previous.recommendations,
    ...args.previous.attentionPoints,
    ...args.previous.orientations,
    args.previous.professionalName ?? "",
    args.previous.specialty ?? "",
  ].filter(Boolean);
  const nextItems = [
    ...recommendations,
    ...attentionPoints,
    ...orientations,
    professionalName ?? "",
    specialty ?? "",
  ].filter(Boolean);

  const rejected = accumulateRejected(previousItems, nextItems, args.previousRejected);
  const panoramaReview = args.panoramaReview?.rejected.length
    ? args.panoramaReview
    : undefined;

  return {
    explanation,
    structured: {
      professionalName,
      specialty,
      recommendations,
      attentionPoints,
      orientations,
      panoramaSnippet: args.previous.panoramaSnippet,
      review: {
        userEditedAt: args.editedAt.toISOString(),
        ...(rejected.length ? { rejected } : { rejected: [] }),
      },
      ...(panoramaReview ? { panoramaReview } : {}),
    },
  };
}

export function buildPatientPanoramaReview(args: {
  previousPanorama: string;
  previousRejected: string[];
  nextPanorama: string;
  editedAt: Date;
}): { panorama: string; review: ConsultationReviewMeta } {
  const panorama = sanitizeText(args.nextPanorama).trim().slice(0, 6_000);
  const rejected = accumulateRejected(
    splitSummarySentences(args.previousPanorama),
    splitSummarySentences(panorama),
    args.previousRejected,
  );
  return {
    panorama,
    review: {
      userEditedAt: args.editedAt.toISOString(),
      rejected,
    },
  };
}

/** Tira do panorama novo as frases que o paciente já apagou. */
export function applyPanoramaRejection(update: string, rejected: string[]): string {
  if (!update.trim() || rejected.length === 0) return update.trim();
  return dropRejectedItems(splitSummarySentences(update), rejected).join(" ").trim();
}

export function readPanoramaReview(raw: unknown): ConsultationReviewMeta {
  return parsePanoramaReview(raw);
}
