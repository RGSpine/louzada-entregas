/**
 * Artefactos derivados da evolução: ações do profissional vs. handout do paciente.
 * Validados com Zod antes de persistir (LGPD / conteúdo clínico).
 */

import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

export const EVOLUTION_ARTIFACTS_VERSION = 1 as const;

const prioritySchema = z.enum(["low", "medium", "high"]).optional();

/** Um item de ação para o profissional (não confundir com bullets do paciente). */
export const professionalActionItemSchema = z.object({
  label: z.string().min(1).max(500),
  type: z
    .string()
    .max(80)
    .optional()
    .describe("ex.: schedule_exam, message, referral, spreadsheet, nutrition_plan, custom"),
  rationale: z.string().max(2000).optional(),
  priority: prioritySchema,
  dueHint: z.string().max(200).optional(),
  /** Concluído pelo profissional na ficha do paciente (persistido no JSON da evolução). */
  completed: z.boolean().optional(),
});

export type ProfessionalActionItem = z.infer<typeof professionalActionItemSchema>;

export const professionalActionsStoredSchema = z.object({
  v: z.literal(EVOLUTION_ARTIFACTS_VERSION),
  items: z.array(professionalActionItemSchema).max(20),
});

export type ProfessionalActionsStored = z.infer<typeof professionalActionsStoredSchema>;

export const patientHandoutStoredSchema = z.object({
  v: z.literal(EVOLUTION_ARTIFACTS_VERSION),
  summary: z.string().max(4000).optional(),
  bullets: z.array(z.string().max(2000)).max(30),
});

export type PatientHandoutStored = z.infer<typeof patientHandoutStoredSchema>;

const medicationKindSchema = z.enum(["medication", "supplement", "other"]).optional();

/**
 * Medicamento ou suplemento mencionado na evolução (áudio, anexos ou texto).
 * Distinto de patientHandout (linguagem leiga) e professionalActions (tarefas).
 */
export const medicationSupplementItemSchema = z.object({
  name: z.string().min(1).max(300),
  kind: medicationKindSchema.describe("medication | supplement | other"),
  dose: z.string().max(200).optional(),
  frequency: z.string().max(200).optional(),
  route: z.string().max(120).optional(),
  effects: z.string().max(2000).optional(),
  interactions: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

export type MedicationSupplementItem = z.infer<typeof medicationSupplementItemSchema>;

export const medicationsAndSupplementsStoredSchema = z.object({
  v: z.literal(EVOLUTION_ARTIFACTS_VERSION),
  summary: z.string().max(4000).optional(),
  items: z.array(medicationSupplementItemSchema).max(30),
});

export type MedicationsAndSupplementsStored = z.infer<
  typeof medicationsAndSupplementsStoredSchema
>;

/** Plano/pacote comercial mencionado (venda ou sessão de plano) — não é action item clínico. */
export const commercialCarePlanLlmSchema = z
  .object({
    contracted: z.boolean().optional(),
    purchaseType: z.enum(["SINGLE", "PACKAGE"]).optional(),
    sessionCount: z.coerce.number().int().min(1).max(200).optional(),
    serviceNameHint: z.string().max(200).optional(),
    thisVisitIsPlanSession: z.boolean().optional(),
    evidence: z.string().max(500).optional(),
    /** Áudio afirma que o pagamento já foi recebido. */
    paymentReceived: z.boolean().optional(),
    paymentMethod: z.enum(["CASH", "PIX", "CARD", "TRANSFER", "OTHER"]).optional(),
    /** Valor citado em reais (não inventar). */
    amountReais: z.coerce.number().min(0).max(1_000_000).optional(),
    /**
     * Quantas sessões o áudio diz que já ocorreram (hint UI).
     * Não inventar datas — baixas históricas ficam em Serviços/Fiscal.
     */
    sessionsAlreadyDone: z.coerce.number().int().min(0).max(200).optional(),
  })
  .optional();

/** Campos opcionais devolvidos pela LLM no mesmo JSON da evolução. */
export const llmEvolutionArtifactsSchema = z.object({
  hasProfessionalActions: z.boolean().optional(),
  hasPatientEducation: z.boolean().optional(),
  hasMedicationsAndSupplements: z.boolean().optional(),
  professionalActions: z.array(professionalActionItemSchema).optional(),
  patientHandoutBullets: z.array(z.string()).optional(),
  patientHandoutSummary: z.string().optional(),
  medicationsAndSupplements: z.array(medicationSupplementItemSchema).optional(),
  medicationsAndSupplementsSummary: z.string().optional(),
  commercialCarePlan: commercialCarePlanLlmSchema,
});

export type LlmEvolutionArtifacts = z.infer<typeof llmEvolutionArtifactsSchema>;

function sanitizeActionItem(item: ProfessionalActionItem): ProfessionalActionItem {
  return {
    label: sanitizeText(item.label).slice(0, 500),
    type: item.type ? sanitizeText(item.type).slice(0, 80) : undefined,
    rationale: item.rationale ? sanitizeText(item.rationale).slice(0, 2000) : undefined,
    priority: item.priority,
    dueHint: item.dueHint ? sanitizeText(item.dueHint).slice(0, 200) : undefined,
    completed: typeof item.completed === "boolean" ? item.completed : undefined,
  };
}

function sanitizeMedicationItem(item: MedicationSupplementItem): MedicationSupplementItem {
  const kind =
    item.kind === "medication" || item.kind === "supplement" || item.kind === "other"
      ? item.kind
      : undefined;
  return {
    name: sanitizeText(item.name).slice(0, 300),
    kind,
    dose: item.dose ? sanitizeText(item.dose).slice(0, 200) : undefined,
    frequency: item.frequency ? sanitizeText(item.frequency).slice(0, 200) : undefined,
    route: item.route ? sanitizeText(item.route).slice(0, 120) : undefined,
    effects: item.effects ? sanitizeText(item.effects).slice(0, 2000) : undefined,
    interactions: item.interactions
      ? sanitizeText(item.interactions).slice(0, 2000)
      : undefined,
    notes: item.notes ? sanitizeText(item.notes).slice(0, 2000) : undefined,
  };
}

/**
 * Converte saída bruta da IA em objetos persistíveis e sanitizados.
 * Tolerante a shapes alternativos (handout aninhado, actions como strings, flags string)
 * — um campo inválido NÃO deve zerar os demais artefactos.
 */
export function parseAndSanitizeEvolutionArtifacts(
  raw: unknown
): {
  professionalActions: ProfessionalActionsStored | undefined;
  patientHandout: PatientHandoutStored | undefined;
  medicationsAndSupplements: MedicationsAndSupplementsStored | undefined;
  commercialCarePlan: z.infer<typeof commercialCarePlanLlmSchema>;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      professionalActions: undefined,
      patientHandout: undefined,
      medicationsAndSupplements: undefined,
      commercialCarePlan: undefined,
    };
  }

  const root = raw as Record<string, unknown>;
  const normalized = normalizeLlmArtifactFields(root);

  let professionalActions: ProfessionalActionsStored | undefined;
  let patientHandout: PatientHandoutStored | undefined;
  let medicationsAndSupplements: MedicationsAndSupplementsStored | undefined;

  const actionsRaw = normalized.professionalActions;
  if (Array.isArray(actionsRaw) && actionsRaw.length > 0) {
    const items = actionsRaw
      .map((entry) => {
        if (typeof entry === "string") {
          const label = sanitizeText(entry).trim().slice(0, 500);
          return label ? sanitizeActionItem({ label, type: "custom" }) : null;
        }
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const rec = entry as Record<string, unknown>;
        const label =
          typeof rec.label === "string"
            ? sanitizeText(rec.label).trim()
            : typeof rec.text === "string"
              ? sanitizeText(rec.text).trim()
              : typeof rec.acao === "string"
                ? sanitizeText(rec.acao).trim()
                : "";
        if (!label) return null;
        const parsedItem = professionalActionItemSchema.safeParse({
          label: label.slice(0, 500),
          type: typeof rec.type === "string" ? rec.type : typeof rec.tipo === "string" ? rec.tipo : "custom",
          rationale:
            typeof rec.rationale === "string"
              ? rec.rationale
              : typeof rec.motivo === "string"
                ? rec.motivo
                : undefined,
          priority: rec.priority,
          dueHint:
            typeof rec.dueHint === "string"
              ? rec.dueHint
              : typeof rec.prazo === "string"
                ? rec.prazo
                : undefined,
        });
        return parsedItem.success ? sanitizeActionItem(parsedItem.data) : null;
      })
      .filter((i): i is ProfessionalActionItem => Boolean(i && i.label.length > 0))
      .slice(0, 20);
    if (items.length > 0) {
      const checked = professionalActionsStoredSchema.safeParse({
        v: EVOLUTION_ARTIFACTS_VERSION,
        items,
      });
      if (checked.success) professionalActions = checked.data;
    }
  }

  const bullets = (normalized.patientHandoutBullets ?? [])
    .map((b) => sanitizeText(b).trim())
    .filter((b) => b.length > 0)
    .slice(0, 30)
    .map((b) => b.slice(0, 2000));
  const summary = normalized.patientHandoutSummary
    ? sanitizeText(normalized.patientHandoutSummary).trim().slice(0, 4000)
    : "";
  if (bullets.length > 0 || summary.length > 0) {
    const checked = patientHandoutStoredSchema.safeParse({
      v: EVOLUTION_ARTIFACTS_VERSION,
      bullets,
      ...(summary ? { summary } : {}),
    });
    if (checked.success) patientHandout = checked.data;
  }

  const medsRaw = normalized.medicationsAndSupplements;
  if (Array.isArray(medsRaw) && medsRaw.length > 0) {
    const coerced = coerceMedicationsAndSupplementsForReview({
      v: EVOLUTION_ARTIFACTS_VERSION,
      items: medsRaw,
      summary: normalized.medicationsAndSupplementsSummary,
    });
    if (
      coerced.items.length > 0 ||
      Boolean(coerced.summary?.trim())
    ) {
      medicationsAndSupplements = coerced;
    }
  } else if (normalized.medicationsAndSupplementsSummary?.trim()) {
    const summaryOnly = sanitizeText(normalized.medicationsAndSupplementsSummary)
      .trim()
      .slice(0, 4000);
    if (summaryOnly) {
      medicationsAndSupplements = {
        v: EVOLUTION_ARTIFACTS_VERSION,
        items: [],
        summary: summaryOnly,
      };
    }
  }

  const commercialParsed = commercialCarePlanLlmSchema.safeParse(
    normalized.commercialCarePlan,
  );
  const commercialCarePlan = commercialParsed.success
    ? commercialParsed.data
      ? {
          contracted: commercialParsed.data.contracted,
          purchaseType: commercialParsed.data.purchaseType,
          sessionCount: commercialParsed.data.sessionCount,
          serviceNameHint: commercialParsed.data.serviceNameHint
            ? sanitizeText(commercialParsed.data.serviceNameHint).slice(0, 200)
            : undefined,
          thisVisitIsPlanSession: commercialParsed.data.thisVisitIsPlanSession,
          evidence: commercialParsed.data.evidence
            ? sanitizeText(commercialParsed.data.evidence).slice(0, 500)
            : undefined,
          paymentReceived: commercialParsed.data.paymentReceived,
          paymentMethod: commercialParsed.data.paymentMethod,
          amountReais: commercialParsed.data.amountReais,
          sessionsAlreadyDone: commercialParsed.data.sessionsAlreadyDone,
        }
      : undefined
    : undefined;

  return {
    professionalActions,
    patientHandout,
    medicationsAndSupplements,
    commercialCarePlan,
  };
}

/** Normaliza aliases / shapes alternativos que a LLM devolve com frequência. */
function normalizeLlmArtifactFields(root: Record<string, unknown>): {
  professionalActions: unknown[];
  patientHandoutBullets: string[];
  patientHandoutSummary: string;
  medicationsAndSupplements: unknown[];
  medicationsAndSupplementsSummary: string;
  commercialCarePlan: unknown;
} {
  let actions: unknown[] = [];
  if (Array.isArray(root.professionalActions)) {
    actions = root.professionalActions;
  } else if (Array.isArray(root.pontosDeAcao)) {
    actions = root.pontosDeAcao as unknown[];
  } else if (Array.isArray(root.actionItems)) {
    actions = root.actionItems as unknown[];
  }

  let bullets: string[] = [];
  let summary = "";

  if (Array.isArray(root.patientHandoutBullets)) {
    bullets = root.patientHandoutBullets.filter((b): b is string => typeof b === "string");
  }
  if (typeof root.patientHandoutSummary === "string") {
    summary = root.patientHandoutSummary;
  }

  const nestedHandout = root.patientHandout ?? root.orientacoes ?? root.patientEducation;
  if (nestedHandout && typeof nestedHandout === "object" && !Array.isArray(nestedHandout)) {
    const h = nestedHandout as Record<string, unknown>;
    if (bullets.length === 0 && Array.isArray(h.bullets)) {
      bullets = h.bullets.filter((b): b is string => typeof b === "string");
    }
    if (!summary && typeof h.summary === "string") summary = h.summary;
  }
  if (bullets.length === 0 && Array.isArray(root.orientacoes)) {
    bullets = (root.orientacoes as unknown[]).filter((b): b is string => typeof b === "string");
  }

  let meds: unknown[] = [];
  if (Array.isArray(root.medicationsAndSupplements)) {
    meds = root.medicationsAndSupplements;
  } else if (Array.isArray(root.medicamentos)) {
    meds = root.medicamentos as unknown[];
  }

  const medsSummary =
    typeof root.medicationsAndSupplementsSummary === "string"
      ? root.medicationsAndSupplementsSummary
      : "";

  return {
    professionalActions: actions,
    patientHandoutBullets: bullets,
    patientHandoutSummary: summary,
    medicationsAndSupplements: meds,
    medicationsAndSupplementsSummary: medsSummary,
    commercialCarePlan: root.commercialCarePlan ?? root.carePlanCommercial,
  };
}

/** Garante shape mínimo para UI de revisão (evita crash se a IA devolver JSON parcial). */
export function coerceProfessionalActionsForReview(raw: unknown): ProfessionalActionsStored {
  const parsed = professionalActionsStoredSchema.safeParse(raw);
  if (parsed.success) {
    const items = parsed.data.items
      .map(sanitizeActionItem)
      .filter((i) => i.label.trim().length > 0)
      .slice(0, 20);
    return { v: EVOLUTION_ARTIFACTS_VERSION, items };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as ProfessionalActionsStored).items)) {
    const itemsRaw = (raw as ProfessionalActionsStored).items;
    const items = itemsRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const label =
          typeof entry.label === "string" ? sanitizeText(entry.label).trim().slice(0, 500) : "";
        if (!label) return null;
        const checked = professionalActionItemSchema.safeParse({
          ...entry,
          label,
        });
        return checked.success ? sanitizeActionItem(checked.data) : null;
      })
      .filter((i): i is ProfessionalActionItem => Boolean(i))
      .slice(0, 20);
    const checked = professionalActionsStoredSchema.safeParse({
      v: EVOLUTION_ARTIFACTS_VERSION,
      items,
    });
    if (checked.success) return checked.data;
  }
  return { v: EVOLUTION_ARTIFACTS_VERSION, items: [] };
}

/**
 * Normaliza handout persistido/legado para a UI.
 * Importante para «Continuar da última»: se Zod falhar no shape estrito (ex.: `v` ausente
 * ou bullet vazio/null), **não** descartar o conteúdo — sanitizar e remontar.
 */
export function coercePatientHandoutForReview(raw: unknown): PatientHandoutStored {
  const parsed = patientHandoutStoredSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const bulletsRaw = Array.isArray(obj.bullets) ? obj.bullets : [];
    const bullets = bulletsRaw
      .filter((b): b is string => typeof b === "string")
      .map((b) => sanitizeText(b).trim())
      .filter((b) => b.length > 0)
      .slice(0, 30)
      .map((b) => b.slice(0, 2000));
    const summaryRaw =
      typeof obj.summary === "string" ? sanitizeText(obj.summary).trim().slice(0, 4000) : "";
    const checked = patientHandoutStoredSchema.safeParse({
      v: EVOLUTION_ARTIFACTS_VERSION,
      bullets,
      ...(summaryRaw ? { summary: summaryRaw } : {}),
    });
    if (checked.success) return checked.data;
  }

  return { v: EVOLUTION_ARTIFACTS_VERSION, bullets: [] };
}

export function coerceMedicationsAndSupplementsForReview(
  raw: unknown,
): MedicationsAndSupplementsStored {
  const parsed = medicationsAndSupplementsStoredSchema.safeParse(raw);
  if (parsed.success) {
    const items = parsed.data.items
      .map(sanitizeMedicationItem)
      .filter((i) => i.name.trim().length > 0)
      .slice(0, 30);
    const summary = parsed.data.summary
      ? sanitizeText(parsed.data.summary).trim().slice(0, 4000)
      : undefined;
    return {
      v: EVOLUTION_ARTIFACTS_VERSION,
      items,
      ...(summary ? { summary } : {}),
    };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
    const items: MedicationSupplementItem[] = [];

    for (const entry of itemsRaw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const rec = entry as Record<string, unknown>;
      const name =
        typeof rec.name === "string" ? sanitizeText(rec.name).trim().slice(0, 300) : "";
      if (!name) continue;

      const kindRaw = typeof rec.kind === "string" ? rec.kind.trim() : undefined;
      const kind =
        kindRaw === "medication" || kindRaw === "supplement" || kindRaw === "other"
          ? kindRaw
          : undefined;

      const optStr = (value: unknown, max: number): string | undefined => {
        if (typeof value !== "string") return undefined;
        const cleaned = sanitizeText(value).trim().slice(0, max);
        return cleaned || undefined;
      };

      items.push(
        sanitizeMedicationItem({
          name,
          kind,
          dose: optStr(rec.dose, 200),
          frequency: optStr(rec.frequency, 200),
          route: optStr(rec.route, 120),
          effects: optStr(rec.effects, 2000),
          interactions: optStr(rec.interactions, 2000),
          notes: optStr(rec.notes, 2000),
        }),
      );
      if (items.length >= 30) break;
    }

    const summaryRaw =
      typeof obj.summary === "string"
        ? sanitizeText(obj.summary).trim().slice(0, 4000)
        : "";
    const checked = medicationsAndSupplementsStoredSchema.safeParse({
      v: EVOLUTION_ARTIFACTS_VERSION,
      items,
      ...(summaryRaw ? { summary: summaryRaw } : {}),
    });
    if (checked.success) return checked.data;
  }

  return { v: EVOLUTION_ARTIFACTS_VERSION, items: [] };
}

/** Texto plano para PDF / append em Evolution.content (estilo EXAMES COMPLEMENTARES). */
export function formatMedicationsAndSupplementsForDocument(
  stored: MedicationsAndSupplementsStored | null | undefined,
): string {
  if (!stored) return "";
  const lines: string[] = [];
  if (stored.summary?.trim()) {
    lines.push(stored.summary.trim());
  }
  for (const item of stored.items ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    const kindLabel =
      item.kind === "supplement"
        ? "Suplemento"
        : item.kind === "other"
          ? "Outro"
          : item.kind === "medication"
            ? "Medicamento"
            : null;
    const head = kindLabel ? `${name} (${kindLabel})` : name;
    const parts: string[] = [head];
    if (item.dose?.trim()) parts.push(`Dose: ${item.dose.trim()}`);
    if (item.frequency?.trim()) parts.push(`Frequência: ${item.frequency.trim()}`);
    if (item.route?.trim()) parts.push(`Via: ${item.route.trim()}`);
    if (item.effects?.trim()) parts.push(`Efeitos: ${item.effects.trim()}`);
    if (item.interactions?.trim()) parts.push(`Interações: ${item.interactions.trim()}`);
    if (item.notes?.trim()) parts.push(`Obs.: ${item.notes.trim()}`);
    lines.push(parts.join(" — "));
  }
  return lines.join("\n").trim();
}

/** Conta itens de ação ainda pendentes (completed !== true) para badge na lista de pacientes. */
export function countProfessionalActionItems(stored: unknown): number {
  const parsed = professionalActionsStoredSchema.safeParse(stored);
  if (!parsed.success) return 0;
  return parsed.data.items.filter((i) => i.completed !== true).length;
}

/** Rótulos amigáveis para `type` dos pontos de ação (nunca exibir snake_case cru). */
export const PROFESSIONAL_ACTION_TYPE_LABELS: Record<string, string> = {
  schedule_exam: "Agendar exame",
  message: "Mensagem / contato",
  spreadsheet: "Planilha / registro",
  referral: "Encaminhamento",
  nutrition_plan: "Plano alimentar",
  custom: "Outro",
};

export function formatProfessionalActionTypeLabel(
  type: string | undefined | null,
): string | null {
  if (!type?.trim()) return null;
  const key = type.trim().toLowerCase();
  return PROFESSIONAL_ACTION_TYPE_LABELS[key] ?? null;
}

export type ProfessionalActionPriority = "low" | "medium" | "high";

export function normalizeProfessionalActionPriority(
  priority: string | undefined | null,
): ProfessionalActionPriority | null {
  if (!priority) return null;
  const key = priority.trim().toLowerCase();
  if (key === "low" || key === "medium" || key === "high") return key;
  return null;
}

/** Prioridade na UI: low = sem pressa (verde), medium = rápida (amarelo), high = urgente (vermelho). */
export function professionalActionPriorityDisplay(
  priority: string | undefined | null,
): { key: ProfessionalActionPriority; label: string; className: string } | null {
  const key = normalizeProfessionalActionPriority(priority);
  if (!key) return null;
  if (key === "low") {
    return {
      key,
      label: "sem pressa",
      className:
        "border-success/40 bg-success/15 text-success dark:border-success/50 dark:bg-success/20 dark:text-success",
    };
  }
  if (key === "medium") {
    return {
      key,
      label: "rápida",
      className:
        "border-warning/40 bg-warning/15 text-warning dark:border-warning/50 dark:bg-warning/20 dark:text-warning",
    };
  }
  return {
    key,
    label: "urgente",
    className:
      "border-destructive/40 bg-destructive/15 text-destructive dark:border-destructive/50 dark:bg-destructive/20 dark:text-destructive",
  };
}

export function professionalActionsHasContent(
  stored: ProfessionalActionsStored | undefined,
): boolean {
  return Boolean(stored?.items.some((i) => i.label.trim().length > 0));
}

export function patientHandoutHasContent(stored: PatientHandoutStored | undefined): boolean {
  if (!stored) return false;
  return stored.bullets.length > 0 || Boolean(stored.summary?.trim());
}

export function medicationsAndSupplementsHasContent(
  stored: MedicationsAndSupplementsStored | undefined,
): boolean {
  if (!stored) return false;
  return (
    stored.items.some((i) => i.name.trim().length > 0) ||
    Boolean(stored.summary?.trim())
  );
}

export function clinicalMetaHasContent(
  meta: Record<string, string | undefined> | undefined,
): boolean {
  if (!meta) return false;
  return Object.values(meta).some((v) => typeof v === "string" && v.trim().length > 0);
}

export type EvolutionArtifactsBundle = {
  clinicalMeta?: Record<string, string | undefined>;
  professionalActions: ProfessionalActionsStored;
  patientHandout: PatientHandoutStored;
  medicationsAndSupplements: MedicationsAndSupplementsStored;
};

function normalizeArtifactKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Igualdade ou inclusão, para não duplicar «marcar retorno» e «marcar retorno em 15 dias». */
function artifactKeysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 8) return false;
  return longer.includes(shorter);
}

function mergeOptionalClinicalText(
  previous: string | undefined,
  next: string | undefined,
  max: number,
): string | undefined {
  const a = sanitizeText(previous ?? "").trim();
  const b = sanitizeText(next ?? "").trim();
  if (!a) return b ? b.slice(0, max) : undefined;
  if (!b) return a.slice(0, max);
  const na = normalizeArtifactKey(a);
  const nb = normalizeArtifactKey(b);
  if (artifactKeysMatch(na, nb)) {
    return (b.length >= a.length ? b : a).slice(0, max);
  }
  return `${a}\n${b}`.slice(0, max);
}

function preferFilled(previous: string | undefined, next: string | undefined, max: number): string | undefined {
  const n = sanitizeText(next ?? "").trim();
  if (n) return n.slice(0, max);
  const p = sanitizeText(previous ?? "").trim();
  return p ? p.slice(0, max) : undefined;
}

/**
 * Continuação da última evolução: a IA integra o que mudou, e o que ela omitir
 * da lista anterior permanece (Pontos de Ação, Orientações, Medicamentos).
 */
export function mergeClinicalContinuationArtifacts(
  fromApi: EvolutionArtifactsBundle,
  previous?: Partial<EvolutionArtifactsBundle>,
): EvolutionArtifactsBundle {
  const prevActions = previous?.professionalActions?.items ?? [];
  const apiActions = fromApi.professionalActions.items ?? [];
  const usedPrevActions = new Set<number>();
  const actions: ProfessionalActionItem[] = [];
  for (const next of apiActions) {
    const key = normalizeArtifactKey(next.label);
    const idx = prevActions.findIndex(
      (item, i) => !usedPrevActions.has(i) && artifactKeysMatch(normalizeArtifactKey(item.label), key),
    );
    if (idx >= 0) {
      usedPrevActions.add(idx);
      const prev = prevActions[idx]!;
      actions.push({
        label: next.label.trim() || prev.label,
        type: preferFilled(prev.type, next.type, 80),
        rationale: preferFilled(prev.rationale, next.rationale, 2000),
        priority: next.priority ?? prev.priority,
        dueHint: preferFilled(prev.dueHint, next.dueHint, 200),
        completed: typeof next.completed === "boolean" ? next.completed : prev.completed,
      });
    } else {
      actions.push(next);
    }
  }
  prevActions.forEach((item, i) => {
    if (!usedPrevActions.has(i)) actions.push(item);
  });

  const prevBullets = previous?.patientHandout?.bullets ?? [];
  const apiBullets = fromApi.patientHandout.bullets ?? [];
  const usedPrevBullets = new Set<number>();
  const bullets: string[] = [];
  for (const next of apiBullets) {
    const key = normalizeArtifactKey(next);
    const idx = prevBullets.findIndex(
      (item, i) => !usedPrevBullets.has(i) && artifactKeysMatch(normalizeArtifactKey(item), key),
    );
    if (idx >= 0) {
      usedPrevBullets.add(idx);
      const prev = prevBullets[idx]!;
      bullets.push(next.trim().length >= prev.trim().length ? next : prev);
    } else if (next.trim()) {
      bullets.push(next);
    }
  }
  prevBullets.forEach((item, i) => {
    if (!usedPrevBullets.has(i) && item.trim()) bullets.push(item);
  });

  const prevMeds = previous?.medicationsAndSupplements?.items ?? [];
  const apiMeds = fromApi.medicationsAndSupplements.items ?? [];
  const usedPrevMeds = new Set<number>();
  const meds: MedicationSupplementItem[] = [];
  for (const next of apiMeds) {
    const key = normalizeArtifactKey(next.name);
    const idx = prevMeds.findIndex(
      (item, i) => !usedPrevMeds.has(i) && artifactKeysMatch(normalizeArtifactKey(item.name), key),
    );
    if (idx >= 0) {
      usedPrevMeds.add(idx);
      const prev = prevMeds[idx]!;
      meds.push({
        name: next.name.trim() || prev.name,
        kind: next.kind ?? prev.kind,
        dose: preferFilled(prev.dose, next.dose, 200),
        frequency: preferFilled(prev.frequency, next.frequency, 200),
        route: preferFilled(prev.route, next.route, 120),
        effects: preferFilled(prev.effects, next.effects, 2000),
        interactions: preferFilled(prev.interactions, next.interactions, 2000),
        notes: preferFilled(prev.notes, next.notes, 2000),
      });
    } else {
      meds.push(next);
    }
  }
  prevMeds.forEach((item, i) => {
    if (!usedPrevMeds.has(i)) meds.push(item);
  });

  return {
    clinicalMeta: clinicalMetaHasContent(fromApi.clinicalMeta)
      ? fromApi.clinicalMeta
      : clinicalMetaHasContent(previous?.clinicalMeta)
        ? previous!.clinicalMeta
        : undefined,
    professionalActions: {
      v: EVOLUTION_ARTIFACTS_VERSION,
      items: actions.slice(0, 20),
    },
    patientHandout: {
      v: EVOLUTION_ARTIFACTS_VERSION,
      summary: mergeOptionalClinicalText(
        previous?.patientHandout?.summary,
        fromApi.patientHandout.summary,
        4000,
      ),
      bullets: bullets.slice(0, 30),
    },
    medicationsAndSupplements: {
      v: EVOLUTION_ARTIFACTS_VERSION,
      summary: mergeOptionalClinicalText(
        previous?.medicationsAndSupplements?.summary,
        fromApi.medicationsAndSupplements.summary,
        4000,
      ),
      items: meds.slice(0, 30),
    },
  };
}

/**
 * Mescla artefactos da IA com rascunho anterior (ex.: «Continuar da última»).
 * A IA só substitui um campo quando trouxer conteúdo significativo; senão mantém o anterior.
 */
export function mergeEvolutionArtifactsPreferringApi(
  fromApi: EvolutionArtifactsBundle,
  previous?: Partial<EvolutionArtifactsBundle>,
): EvolutionArtifactsBundle {
  return {
    clinicalMeta: clinicalMetaHasContent(fromApi.clinicalMeta)
      ? fromApi.clinicalMeta
      : clinicalMetaHasContent(previous?.clinicalMeta)
        ? previous!.clinicalMeta
        : undefined,
    professionalActions: professionalActionsHasContent(fromApi.professionalActions)
      ? fromApi.professionalActions
      : professionalActionsHasContent(previous?.professionalActions)
        ? previous!.professionalActions!
        : fromApi.professionalActions,
    patientHandout: patientHandoutHasContent(fromApi.patientHandout)
      ? fromApi.patientHandout
      : patientHandoutHasContent(previous?.patientHandout)
        ? previous!.patientHandout!
        : fromApi.patientHandout,
    medicationsAndSupplements: medicationsAndSupplementsHasContent(
      fromApi.medicationsAndSupplements,
    )
      ? fromApi.medicationsAndSupplements
      : medicationsAndSupplementsHasContent(previous?.medicationsAndSupplements)
        ? previous!.medicationsAndSupplements!
        : fromApi.medicationsAndSupplements,
  };
}
