import { sanitizeText } from "@/lib/sanitize";
import { stripFinancialMentionsFromClinicalText } from "@/lib/evolution-transcription-sanitize";
import {
  coerceMedicationsAndSupplementsForReview,
  coercePatientHandoutForReview,
  coerceProfessionalActionsForReview,
  type MedicationsAndSupplementsStored,
  type PatientHandoutStored,
  type ProfessionalActionsStored,
} from "@/lib/evolution-artifacts";

/**
 * Rascunho da última evolução para «Continuar da última» / Usar como base.
 * Inclui texto clínico + campos de formulário + exames + artefactos
 * (Pontos de Ação / Orientações / Medicamentos) e clinicalMeta.
 */
export type EvolutionCopyDraft = {
  evolutionId: string;
  dateLabel: string;
  preview: string;
  /** Corpo clínico (sem bloco EXAMES / MEDICAMENTOS anexado no save). */
  content: string;
  /** Análise de exames complementares (secção separada na UI). */
  examsAnalysis: string;
  /** Campos editáveis do formulário Nova Evolução. */
  queixa: string;
  diagnostico: string;
  conduta: string;
  professionalActions: ProfessionalActionsStored;
  patientHandout: PatientHandoutStored;
  medicationsAndSupplements: MedicationsAndSupplementsStored;
  clinicalMeta?: Record<string, string | undefined>;
};

/** Chaves de formulário persistidas dentro de `Evolution.clinicalMeta`. */
export const EVOLUTION_FORM_META_KEYS = {
  queixa: "formQueixa",
  conduta: "formConduta",
  diagnostico: "formDiagnostico",
} as const;

const PREVIEW_MAX = 220;
const FORM_FIELD_MAX = 4000;

const EXAMS_SECTION_RE =
  /\n\n---\n\nEXAMES COMPLEMENTARES:\n/i;
const MEDS_SECTION_RE =
  /\n\n---\n\nMEDICAMENTOS E SUPLEMENTOS:\n/i;

export function buildEvolutionCopyPreview(content: string): string {
  const clean = sanitizeText(content).replace(/\s+/g, " ").trim();
  if (clean.length <= PREVIEW_MAX) return clean;
  return `${clean.slice(0, PREVIEW_MAX - 1)}…`;
}

export function formatEvolutionCopyDateLabel(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function clipFormField(value: string): string {
  return sanitizeText(value).trim().slice(0, FORM_FIELD_MAX);
}

/**
 * Separa o `content` persistido (corpo + exames + meds concatenados no save)
 * para restaurar o formulário e o bloco de exames na Nova Evolução.
 */
export function splitEvolutionContentSections(content: string): {
  body: string;
  examsAnalysis: string;
} {
  const raw = sanitizeText(content ?? "");
  if (!raw.trim()) return { body: "", examsAnalysis: "" };

  let working = raw;
  let examsAnalysis = "";

  const medsSplit = working.split(MEDS_SECTION_RE);
  if (medsSplit.length > 1) {
    working = medsSplit[0] ?? "";
  }

  const examsSplit = working.split(EXAMS_SECTION_RE);
  if (examsSplit.length > 1) {
    working = examsSplit[0] ?? "";
    examsAnalysis = clipFormField(
      examsSplit.slice(1).join("\n\n---\n\nEXAMES COMPLEMENTARES:\n"),
    );
  }

  return {
    body: working.trim(),
    examsAnalysis,
  };
}

/** Normaliza clinicalMeta persistido (Json) para o shape usado na revisão/salvamento. */
export function clinicalMetaFromEvolutionJson(
  raw: unknown,
): Record<string, string | undefined> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string | undefined> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const cleaned = sanitizeText(value).trim();
    if (!cleaned) continue;
    out[key] = cleaned.slice(0, FORM_FIELD_MAX);
    hasAny = true;
  }
  return hasAny ? out : undefined;
}

function formFieldsFromClinicalMeta(
  meta: Record<string, string | undefined> | undefined,
): { queixa: string; conduta: string; diagnostico: string } {
  if (!meta) return { queixa: "", conduta: "", diagnostico: "" };
  const queixa =
    meta[EVOLUTION_FORM_META_KEYS.queixa]?.trim() ||
    meta.queixa?.trim() ||
    meta.queixaPrincipal?.trim() ||
    "";
  const conduta =
    meta[EVOLUTION_FORM_META_KEYS.conduta]?.trim() ||
    meta.conduta?.trim() ||
    "";
  const diagnostico =
    meta[EVOLUTION_FORM_META_KEYS.diagnostico]?.trim() ||
    meta.diagnosticoCompleto?.trim() ||
    meta.diagnostico?.trim() ||
    "";
  return {
    queixa: clipFormField(queixa),
    conduta: clipFormField(conduta),
    diagnostico: clipFormField(diagnostico),
  };
}

/**
 * Fallback para evoluções antigas (antes de formQueixa/formConduta):
 * tenta recuperar secções rotuladas ou frases de conduta no corpo clínico.
 */
export function extractLegacyFormFieldsFromContent(content: string): {
  queixa: string;
  conduta: string;
} {
  const text = sanitizeText(content ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { queixa: "", conduta: "" };

  const labeledQueixa = text.match(
    /(?:^|\n)\s*(?:QUEIXA(?:\s+PRINCIPAL)?|Queixa(?:\s+principal)?)\s*[:\-–]\s*([^\n]+)/i,
  );
  const labeledConduta = text.match(
    /(?:^|\n)\s*(?:CONDUTA|Conduta)\s*[:\-–]\s*([^\n]+)/i,
  );

  let queixa = labeledQueixa?.[1]?.trim() ?? "";
  let conduta = labeledConduta?.[1]?.trim() ?? "";

  if (!conduta) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const condutaSentence = sentences.find((s) =>
      /^(?:a\s+)?conduta\b/i.test(s) || /\bconduta\s+atual\b/i.test(s),
    );
    if (condutaSentence) conduta = condutaSentence;
  }

  if (!queixa) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const queixaSentence = sentences.find(
      (s) =>
        /\bqueixa\b/i.test(s) ||
        /\brelata\b/i.test(s) ||
        /\brefere\b/i.test(s) ||
        /\bapresenta\b/i.test(s),
    );
    // Evitar frases só de melhora genérica sem queixa clínica clara
    if (
      queixaSentence &&
      !/\bboa melhora\b/i.test(queixaSentence) &&
      queixaSentence.length >= 20
    ) {
      queixa = queixaSentence;
    }
  }

  return {
    queixa: clipFormField(queixa),
    conduta: clipFormField(conduta),
  };
}

/**
 * Mescla campos do formulário em clinicalMeta para persistência
 * (sem sobrescrever tags clínicas do tagger como `diagnostico`/`regiao`).
 *
 * Semântica: `undefined` preserva a chave existente; string vazia remove;
 * string não vazia grava. Importante para saves mobile/API que omitem
 * patientQueixa/patientConduta e não devem apagar formQueixa/formConduta.
 */
export function mergeFormFieldsIntoClinicalMeta(
  clinicalMeta: Record<string, string | undefined> | undefined,
  fields: { queixa?: string; conduta?: string; diagnostico?: string },
): Record<string, string | undefined> | undefined {
  const next: Record<string, string | undefined> = { ...(clinicalMeta ?? {}) };

  const applyOptional = (
    key: string,
    value: string | undefined,
  ): void => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed) next[key] = clipFormField(trimmed);
    else delete next[key];
  };

  applyOptional(EVOLUTION_FORM_META_KEYS.queixa, fields.queixa);
  applyOptional(EVOLUTION_FORM_META_KEYS.conduta, fields.conduta);
  applyOptional(EVOLUTION_FORM_META_KEYS.diagnostico, fields.diagnostico);

  const hasAny = Object.values(next).some((v) => typeof v === "string" && v.trim());
  return hasAny ? next : undefined;
}

export function evolutionRowToCopyDraft(row: {
  id: string;
  date: Date;
  content: string | null;
  professionalActions?: unknown;
  patientHandout?: unknown;
  medicationsAndSupplements?: unknown;
  clinicalMeta?: unknown;
}): EvolutionCopyDraft | null {
  const clinicalMeta = clinicalMetaFromEvolutionJson(row.clinicalMeta);
  const { body, examsAnalysis } = splitEvolutionContentSections(row.content ?? "");
  const formFromMeta = formFieldsFromClinicalMeta(clinicalMeta);
  const legacy =
    !formFromMeta.queixa || !formFromMeta.conduta
      ? extractLegacyFormFieldsFromContent(body)
      : { queixa: "", conduta: "" };
  const form = {
    queixa: formFromMeta.queixa || legacy.queixa,
    conduta: formFromMeta.conduta || legacy.conduta,
    diagnostico: formFromMeta.diagnostico,
  };
  const professionalActions = coerceProfessionalActionsForReview(row.professionalActions);
  const patientHandout = coercePatientHandoutForReview(row.patientHandout);
  const medicationsAndSupplements = coerceMedicationsAndSupplementsForReview(
    row.medicationsAndSupplements,
  );

  const hasArtifacts =
    professionalActions.items.length > 0 ||
    patientHandout.bullets.length > 0 ||
    Boolean(patientHandout.summary?.trim()) ||
    medicationsAndSupplements.items.length > 0 ||
    Boolean(medicationsAndSupplements.summary?.trim()) ||
    Boolean(clinicalMeta) ||
    Boolean(form.queixa || form.conduta || form.diagnostico) ||
    Boolean(examsAnalysis);

  if (!body && !hasArtifacts) return null;

  return {
    evolutionId: row.id,
    dateLabel: formatEvolutionCopyDateLabel(row.date),
    preview: body
      ? buildEvolutionCopyPreview(body)
      : "Última evolução com formulário / orientações / pontos de ação / medicamentos.",
    content: body,
    examsAnalysis,
    queixa: form.queixa,
    diagnostico: form.diagnostico,
    conduta: form.conduta,
    professionalActions,
    patientHandout,
    medicationsAndSupplements,
    clinicalMeta,
  };
}

/**
 * Garante shape mínimo do draft para UI (evita crash se artefactos vierem
 * opcionais / ausentes — ex.: contrato mobile ou payload parcial).
 */
export function ensureEvolutionCopyDraftArtifacts(
  draft: Partial<
    Pick<
      EvolutionCopyDraft,
      "professionalActions" | "patientHandout" | "medicationsAndSupplements"
    >
  >,
): Pick<
  EvolutionCopyDraft,
  "professionalActions" | "patientHandout" | "medicationsAndSupplements"
> {
  return {
    professionalActions: coerceProfessionalActionsForReview(draft.professionalActions),
    patientHandout: coercePatientHandoutForReview(draft.patientHandout),
    medicationsAndSupplements: coerceMedicationsAndSupplementsForReview(
      draft.medicationsAndSupplements,
    ),
  };
}

/**
 * Texto da última evolução enviado à IA no modo continuação clínica.
 * A IA reescreve um documento único (sem colar um parágrafo no final).
 * Valor/pagamento não entram neste bloco.
 */
function formatContinuationArtifacts(
  draft: Partial<
    Pick<
      EvolutionCopyDraft,
      "professionalActions" | "patientHandout" | "medicationsAndSupplements"
    >
  >,
): string {
  const arts = ensureEvolutionCopyDraftArtifacts(draft);
  const blocks: string[] = [];

  if (arts.professionalActions.items.length > 0) {
    const lines = arts.professionalActions.items.map((item) => {
      const bits = [item.label];
      if (item.dueHint) bits.push(item.dueHint);
      if (item.completed) bits.push("concluído");
      return `- ${bits.join(" — ")}`;
    });
    blocks.push(`PONTOS DE AÇÃO JÁ REGISTRADOS:\n${lines.join("\n")}`);
  }

  const handoutLines = [
    ...(arts.patientHandout.summary?.trim()
      ? [`Resumo: ${arts.patientHandout.summary.trim()}`]
      : []),
    ...arts.patientHandout.bullets.filter((b) => b.trim()).map((b) => `- ${b.trim()}`),
  ];
  if (handoutLines.length > 0) {
    blocks.push(`ORIENTAÇÕES AO PACIENTE JÁ REGISTRADAS:\n${handoutLines.join("\n")}`);
  }

  if (
    arts.medicationsAndSupplements.items.length > 0 ||
    arts.medicationsAndSupplements.summary?.trim()
  ) {
    const lines = arts.medicationsAndSupplements.items.map((item) => {
      const bits = [item.name];
      if (item.dose) bits.push(item.dose);
      if (item.frequency) bits.push(item.frequency);
      if (item.route) bits.push(item.route);
      return `- ${bits.join(" — ")}`;
    });
    if (arts.medicationsAndSupplements.summary?.trim()) {
      lines.unshift(`Resumo: ${arts.medicationsAndSupplements.summary.trim()}`);
    }
    blocks.push(`MEDICAMENTOS E SUPLEMENTOS JÁ REGISTRADOS:\n${lines.join("\n")}`);
  }

  return blocks.join("\n\n");
}

export function buildClinicalContinuationExistingContent(
  draft: Pick<
    EvolutionCopyDraft,
    "queixa" | "diagnostico" | "conduta" | "content" | "examsAnalysis"
  > &
    Partial<
      Pick<
        EvolutionCopyDraft,
        "professionalActions" | "patientHandout" | "medicationsAndSupplements"
      >
    >,
): string {
  const parts: string[] = [];
  const queixa = draft.queixa?.trim();
  const diagnostico = draft.diagnostico?.trim();
  const conduta = draft.conduta?.trim();
  const content = draft.content?.trim();
  const exams = draft.examsAnalysis?.trim();
  if (queixa) parts.push(`Queixa: ${queixa}`);
  if (diagnostico) parts.push(`Diagnóstico: ${diagnostico}`);
  if (conduta) parts.push(`Conduta: ${conduta}`);
  if (content) parts.push(content);
  if (exams) parts.push(`Exames complementares:\n${exams}`);
  const clinical = stripFinancialMentionsFromClinicalText(parts.join("\n\n")).trim();
  const artifacts = formatContinuationArtifacts(draft);
  return [clinical, artifacts].filter(Boolean).join("\n\n").trim();
}

/** Resumo do que o draft carrega (toast / hints). */
export function describeEvolutionCopyDraft(draft: EvolutionCopyDraft): string {
  const parts: string[] = ["texto"];
  if (draft.queixa || draft.conduta || draft.diagnostico) {
    parts.push("queixa/diagnóstico/conduta");
  }
  if (draft.examsAnalysis.trim()) parts.push("exames");
  const arts = ensureEvolutionCopyDraftArtifacts(draft);
  if (arts.professionalActions.items.length > 0) parts.push("pontos de ação");
  if (
    arts.patientHandout.bullets.length > 0 ||
    Boolean(arts.patientHandout.summary?.trim())
  ) {
    parts.push("orientações");
  }
  if (
    arts.medicationsAndSupplements.items.length > 0 ||
    Boolean(arts.medicationsAndSupplements.summary?.trim())
  ) {
    parts.push("medicamentos");
  }
  return parts.join(", ");
}
