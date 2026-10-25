/**
 * Checagem da consulta do paciente contra a transcrição/OCR.
 * A explicação em linguagem leiga permanece: só caem expansões de sigla,
 * nomes de método e itens de lista que não estão na fonte.
 */
import {
  auditClinicalText,
  filterGroundedBullets,
  findUngroundedClinicalTerms,
} from "@/lib/clinical-harness";

export const PATIENT_INTAKE_EXTRACTION_POLICY = `
POLITICA DE EXTRACAO (OBRIGATORIA):
FONTE: somente a transcrição ou o texto do exame abaixo. Nada além disso.
PERMITIDO: explicar em linguagem simples o que foi dito ou está escrito, reordenar e pontuar.
PROIBIDO: diagnóstico novo, medicamento, dose, exame, nome de profissional, especialidade, técnica ou sigla por extenso que não estejam na fonte.
Sigla dita sem o nome por extenso fica só como sigla.
Trecho [inaudível] ou frase cortada: não complete.
Campo sem base: null. Lista sem base: [].
`.trim();

type IntakeTask = {
  title: string;
  type: "MEDICATION" | "EXAM" | "RETURN_VISIT" | "WATER" | "OTHER";
  scheduledTime?: string | null;
};

export type PatientIntakeDraft = {
  translatedExplanation: string;
  professionalName: string | null;
  specialty: string | null;
  recommendations: string[];
  attentionPoints: string[];
  orientations: string[];
  panoramaSnippet: string | null;
  tasks: IntakeTask[];
};

function anchoredLabel(value: string | null, source: string): string | null {
  const clean = value?.trim() ?? "";
  if (!clean) return null;
  const audit = auditClinicalText(clean, source);
  if (findUngroundedClinicalTerms(audit.text, source).length > 0) return null;
  const folded = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const words = audit.text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5);
  if (words.length > 0 && words.every((word) => !folded.includes(word.slice(0, 5)))) {
    return null;
  }
  return audit.text;
}

export function groundPatientIntake(
  draft: PatientIntakeDraft,
  source: string,
): { draft: PatientIntakeDraft; warnings: string[] } {
  const warnings: string[] = [];
  const explanation = auditClinicalText(draft.translatedExplanation, source);
  warnings.push(...explanation.warnings);

  const panorama = draft.panoramaSnippet
    ? auditClinicalText(draft.panoramaSnippet, source)
    : { text: "", warnings: [] as string[] };
  warnings.push(...panorama.warnings);

  const lists = {
    recommendations: filterGroundedBullets(draft.recommendations, source),
    attentionPoints: filterGroundedBullets(draft.attentionPoints, source),
    orientations: filterGroundedBullets(draft.orientations, source),
  };
  const listLabels: Record<keyof typeof lists, string> = {
    recommendations: "recomendações",
    attentionPoints: "pontos de atenção",
    orientations: "orientações",
  };
  for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
    const result = lists[key];
    if (result.dropped.length > 0) {
      warnings.push(
        `Removemos ${result.dropped.length} item(ns) de ${listLabels[key]} que não apareciam na gravação ou no exame.`,
      );
    }
  }

  const tasks = draft.tasks.flatMap((task) => {
    const grounded = filterGroundedBullets([task.title], source);
    if (grounded.dropped.length > 0) {
      warnings.push(`Tarefa removida por não constar na fonte: «${task.title.slice(0, 80)}».`);
      return [];
    }
    return [{ ...task, title: grounded.kept[0] ?? task.title }];
  });

  const unique = [...new Set(warnings)].slice(0, 3);
  return {
    draft: {
      ...draft,
      translatedExplanation: explanation.text.trim() || draft.translatedExplanation,
      professionalName: anchoredLabel(draft.professionalName, source),
      specialty: anchoredLabel(draft.specialty, source),
      recommendations: lists.recommendations.kept,
      attentionPoints: lists.attentionPoints.kept,
      orientations: lists.orientations.kept,
      panoramaSnippet: panorama.text.trim() || null,
      tasks,
    },
    warnings: unique,
  };
}
