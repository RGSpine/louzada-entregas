/**
 * Sinais comerciais de plano/pacote extraídos da evolução (áudio/texto).
 * Distintos de professionalActions clínicos — alimentam Consultório Financeiro e Agenda.
 */

import { z } from "zod";
import type { FinancialTransactionMethod } from "@prisma/client";
import { sanitizeText } from "@/lib/sanitize";
import type { ProfessionalActionsStored } from "@/lib/evolution-artifacts";
import type { EvolutionServiceSuggestion } from "@/lib/evolution-service-suggestion";
import { detectEvolutionServiceSuggestion } from "@/lib/evolution-service-suggestion";
import { inferPortuguesePayment } from "@/lib/finance/portuguese-payment";

export const commercialPaymentMethodSchema = z.enum([
  "CASH",
  "PIX",
  "CARD",
  "TRANSFER",
  "OTHER",
]);

export const commercialCarePlanSchema = z.object({
  /** Paciente contratou / já tem plano ou pacote de sessões (afirmação no material). */
  contracted: z.boolean().optional(),
  purchaseType: z.enum(["SINGLE", "PACKAGE"]).optional(),
  sessionCount: z.number().int().min(1).max(200).optional(),
  /** Nome aproximado do serviço citado (para match no catálogo). */
  serviceNameHint: z.string().max(200).optional(),
  /**
   * Esta evolução/consulta é sessão de um plano já contratado (não venda avulsa).
   * Quando true e já houver pacote, a Agenda deve preferir TREATMENT_PLAN.
   */
  thisVisitIsPlanSession: z.boolean().optional(),
  /** Trecho curto que fundamenta a detecção (sem inventar). */
  evidence: z.string().max(500).optional(),
  /** Áudio afirma que o pagamento já foi recebido. */
  paymentReceived: z.boolean().optional(),
  paymentMethod: commercialPaymentMethodSchema.optional(),
  /** Valor citado em reais (não inventar). */
  amountReais: z.number().min(0).max(1_000_000).optional(),
  /**
   * Quantas sessões o áudio diz que já ocorreram (hint UI).
   * Não inventar datas — baixas históricas ficam em Serviços/Fiscal.
   */
  sessionsAlreadyDone: z.number().int().min(0).max(200).optional(),
});

export type CommercialCarePlan = z.infer<typeof commercialCarePlanSchema>;
export type CommercialPaymentMethod = z.infer<typeof commercialPaymentMethodSchema>;

const PLAN_REMINDER_STORAGE_PREFIX = "aievolui:commercial-plan-reminder:";

export type CommercialPlanReminderPayload = {
  sessionCount?: number;
  purchaseType?: "SINGLE" | "PACKAGE";
  serviceNameHint?: string;
  evidence?: string;
  createdAt: string;
};

function hasCommercialSignal(data: CommercialCarePlan): boolean {
  return (
    data.contracted === true ||
    data.thisVisitIsPlanSession === true ||
    data.purchaseType != null ||
    data.sessionCount != null ||
    Boolean(data.serviceNameHint?.trim()) ||
    data.paymentReceived === true ||
    data.paymentReceived === false ||
    data.paymentMethod != null ||
    (data.amountReais != null && data.amountReais > 0) ||
    (data.sessionsAlreadyDone != null && data.sessionsAlreadyDone > 0)
  );
}

/** Extrai valor em reais de trechos como «R$ 600», «600 reais», «R$1.200,00». */
export function extractAmountReaisFromText(text: string): number | undefined {
  const raw = text.trim();
  if (!raw) return undefined;

  const patterns: RegExp[] = [
    /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*reais?\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (!m?.[1]) continue;
    const token = m[1];
    const normalized = token.includes(",")
      ? token.replace(/\./g, "").replace(",", ".")
      : token.replace(/\./g, "");
    const num = Number(normalized);
    if (Number.isFinite(num) && num > 0 && num <= 1_000_000) return num;
  }
  return undefined;
}

export function detectPaymentReceivedFromText(text: string): boolean | undefined {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const unpaid =
    /\bnao\s+pag(?:ou|o)\b/.test(normalized) ||
    /\bainda\s+nao\s+pag/.test(normalized) ||
    /\bpagamento\s+pendente\b/.test(normalized) ||
    /\ba\s+pagar\b/.test(normalized) ||
    /\bsem\s+pagamento\b/.test(normalized);
  if (unpaid) return false;
  const paid =
    /\bvalor\s+pago\b/.test(normalized) ||
    /\bja\s+pag(?:ou|o)\b/.test(normalized) ||
    /\bpag(?:ou|o)\s+(?:no|via|em|com)\b/.test(normalized) ||
    /\bpag(?:ou|o)\s+(?:pix|dinheiro|cartao|transferencia)\b/.test(normalized) ||
    /\brecebi\s+(?:o\s+)?(?:pagamento|pix|valor)\b/.test(normalized) ||
    /\bpago\s+(?:no|via|em)\s+pix\b/.test(normalized);
  if (paid) return true;
  return undefined;
}

export function detectSessionsAlreadyDoneFromText(text: string): number | undefined {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const patterns: RegExp[] = [
    /(?:ja\s+)?(?:fez|realizou|completou|fezemos)\s+(\d{1,3})\s*(?:sess(?:ao|oes)|atendimentos?|consultas?)/,
    /(\d{1,3})\s*(?:sess(?:ao|oes)|atendimentos?|consultas?)\s+(?:ja\s+)?(?:feitas?|realizadas?|ocorridas?)/,
    /(?:a|na)\s+(\d{1,3})[aª]?\s*sess(?:ao)?/,
  ];
  for (const re of patterns) {
    const m = re.exec(normalized);
    if (!m?.[1]) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 200) return n;
  }
  if (/primeira\s+sessao|1[aª]\s*sessao/.test(normalized)) return 1;
  return undefined;
}

export function parseCommercialCarePlan(raw: unknown): CommercialCarePlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;
  const candidate = root.commercialCarePlan ?? root.carePlanCommercial;
  const parsed = commercialCarePlanSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  if (!hasCommercialSignal(data)) return undefined;
  return {
    contracted: data.contracted,
    purchaseType: data.purchaseType,
    sessionCount: data.sessionCount,
    serviceNameHint: data.serviceNameHint
      ? sanitizeText(data.serviceNameHint).slice(0, 200)
      : undefined,
    thisVisitIsPlanSession: data.thisVisitIsPlanSession,
    evidence: data.evidence ? sanitizeText(data.evidence).slice(0, 500) : undefined,
    paymentReceived: data.paymentReceived,
    paymentMethod: data.paymentMethod,
    amountReais: data.amountReais,
    sessionsAlreadyDone: data.sessionsAlreadyDone,
  };
}

/** Heurística no texto quando a LLM omite commercialCarePlan. */
export function detectCommercialCarePlanFromText(text: string): CommercialCarePlan | undefined {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.trim().length < 12) return undefined;

  const packageMatch = normalized.match(
    /(?:plano|pacote|programa)\s+(?:de\s+)?(?:atendimento\s+)?(?:de\s+)?(\d{1,3})\s*(?:sess(?:ao|oes)|atendimentos?|consultas?)/,
  );
  const sessionsOnly = normalized.match(
    /(?:contratou|adquiriu|comprou|fechou|assinou).{0,40}?(\d{1,3})\s*(?:sess(?:ao|oes)|atendimentos?|consultas?)/,
  );
  const sessionCountRaw = packageMatch?.[1] ?? sessionsOnly?.[1];
  const sessionCount = sessionCountRaw ? Number(sessionCountRaw) : undefined;
  const contracted =
    Boolean(packageMatch || sessionsOnly) ||
    /(?:contratou|adquiriu|comprou|fechou)\s+(?:um\s+)?(?:plano|pacote)/.test(normalized);

  const thisVisitIsPlanSession =
    /(?:sessao|consulta)\s+(?:do|de)\s+plano/.test(normalized) ||
    /(?:usando|usar|consumir)\s+(?:o\s+)?(?:plano|pacote)/.test(normalized) ||
    (contracted && /hoje\s+(?:foi|e)\s+(?:a\s+)?(?:primeira|1[aª]?)\s+sessao/.test(normalized));

  const payment = inferPortuguesePayment({ text });
  const paymentReceived = detectPaymentReceivedFromText(text);
  const amountReais = extractAmountReaisFromText(text);
  const sessionsAlreadyDone = detectSessionsAlreadyDoneFromText(text);

  const paymentMethod = payment.method as FinancialTransactionMethod | null;

  if (
    !contracted &&
    !thisVisitIsPlanSession &&
    !(sessionCount && sessionCount >= 2) &&
    paymentReceived == null &&
    !paymentMethod &&
    amountReais == null &&
    sessionsAlreadyDone == null
  ) {
    return undefined;
  }

  // Só sinal financeiro isolado (sem plano/serviço) não basta para sugerir venda.
  if (
    !contracted &&
    !thisVisitIsPlanSession &&
    !(sessionCount && sessionCount >= 2) &&
    (paymentReceived != null || paymentMethod || amountReais != null)
  ) {
    // Mantém se houver sessão já feita + plano implícito, senão só com contratação.
    if (sessionsAlreadyDone == null) {
      return undefined;
    }
  }

  const purchaseType =
    (sessionCount != null && sessionCount >= 2) || contracted ? "PACKAGE" : undefined;

  return {
    contracted: contracted || undefined,
    purchaseType,
    sessionCount:
      sessionCount != null && Number.isFinite(sessionCount) && sessionCount >= 1
        ? sessionCount
        : undefined,
    thisVisitIsPlanSession: thisVisitIsPlanSession || undefined,
    evidence: packageMatch?.[0] ?? sessionsOnly?.[0],
    paymentReceived,
    paymentMethod: paymentMethod ?? undefined,
    amountReais,
    sessionsAlreadyDone,
  };
}

export function mergeCommercialCarePlans(
  fromLlm: CommercialCarePlan | undefined,
  fromText: CommercialCarePlan | undefined,
): CommercialCarePlan | undefined {
  if (!fromLlm && !fromText) return undefined;
  return {
    contracted: fromLlm?.contracted ?? fromText?.contracted,
    purchaseType: fromLlm?.purchaseType ?? fromText?.purchaseType,
    sessionCount: fromLlm?.sessionCount ?? fromText?.sessionCount,
    serviceNameHint: fromLlm?.serviceNameHint ?? fromText?.serviceNameHint,
    thisVisitIsPlanSession:
      fromLlm?.thisVisitIsPlanSession ?? fromText?.thisVisitIsPlanSession,
    evidence: fromLlm?.evidence ?? fromText?.evidence,
    paymentReceived: fromLlm?.paymentReceived ?? fromText?.paymentReceived,
    paymentMethod: fromLlm?.paymentMethod ?? fromText?.paymentMethod,
    amountReais: fromLlm?.amountReais ?? fromText?.amountReais,
    sessionsAlreadyDone: fromLlm?.sessionsAlreadyDone ?? fromText?.sessionsAlreadyDone,
  };
}

/** Remove action items que só lembram de cadastrar/registrar o plano já reconhecido. */
export function stripCommercialRegistrationActions(
  actions: ProfessionalActionsStored | undefined,
  plan: CommercialCarePlan | undefined,
): ProfessionalActionsStored | undefined {
  if (!actions?.items.length) return actions;
  if (!plan?.contracted && plan?.purchaseType !== "PACKAGE") return actions;

  const filtered = actions.items.filter((item) => {
    const label = item.label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const isCommercialOnly =
      /(cadastrar|registrar|lancar|vincular|criar).{0,40}(plano|pacote|venda|servico)/.test(
        label,
      ) ||
      /(lembrar|nao esquecer).{0,40}(plano|pacote|sessoe)/.test(label) ||
      /^(plano|pacote)\s+(de\s+)?\d+\s*sess/.test(label);
    return !isCommercialOnly;
  });

  if (filtered.length === actions.items.length) return actions;
  return { v: 1, items: filtered };
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unifica sinónimos comerciais para comparação (sessões ≈ atendimentos ≈ consultas). */
export function normalizeCatalogSynonyms(value: string): string {
  return normalizeForMatch(value)
    .replace(/\bsessoes\b/g, "atendimentos")
    .replace(/\bsessao\b/g, "atendimento")
    .replace(/\bconsultas\b/g, "atendimentos")
    .replace(/\bconsulta\b/g, "atendimento")
    .replace(/\bvisitas\b/g, "atendimentos")
    .replace(/\bvisita\b/g, "atendimento")
    .replace(/\bencontros\b/g, "atendimentos")
    .replace(/\bencontro\b/g, "atendimento");
}

/** Extrai N de nomes como «Plano de 4 Atendimentos» / «Pacote 8 sessões». */
export function extractSessionCountFromServiceName(name: string): number | null {
  const n = normalizeCatalogSynonyms(name);
  const m =
    n.match(
      /(?:plano|pacote|programa)\s+(?:especifico\s+)?(?:de\s+)?(?:reabilitacao\s+)?(?:de\s+)?(\d{1,3})\s*atendimentos?\b/,
    ) ??
    n.match(/\b(\d{1,3})\s*atendimentos?\b/) ??
    n.match(/(?:plano|pacote|programa).{0,24}?\b(\d{1,3})\b/);
  if (!m?.[1]) return null;
  const count = Number(m[1]);
  return Number.isFinite(count) && count >= 2 && count <= 200 ? count : null;
}

function matchServiceBySessionCount(
  sessionCount: number,
  services: Array<{ id: string; name: string; defaultPriceCents: number }>,
): { id: string; name: string; defaultPriceCents: number } | null {
  const candidates = services.filter(
    (service) => extractSessionCountFromServiceName(service.name) === sessionCount,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const planLike = candidates.filter((service) =>
    /(?:plano|pacote|programa)\b/.test(normalizeForMatch(service.name)),
  );
  if (planLike.length === 1) return planLike[0]!;
  // Ambíguo (ex.: dois «plano de 4…») — não inventar match.
  return null;
}

function matchServiceByHint(
  hint: string | undefined,
  services: Array<{ id: string; name: string; defaultPriceCents: number }>,
  sessionCount?: number,
): { id: string; name: string; defaultPriceCents: number } | null {
  if (!hint?.trim() || services.length === 0) return null;
  const needle = normalizeCatalogSynonyms(hint);
  if (needle.length < 3) return null;

  // «fisioterapia» sozinha é demasiado genérica — só ajuda a desempatar com N sessões.
  const genericProfession =
    /^(fisio|fisioterapia|pilates|rpg|liberacao|consulta|avaliacao)$/.test(needle) ||
    needle.split(" ").length === 1;

  const scored = services
    .map((service) => {
      const name = normalizeCatalogSynonyms(service.name);
      let score = 0;
      if (name === needle) score = 100;
      else if (name.includes(needle) || needle.includes(name)) score = 80;
      else {
        const parts = needle.split(" ").filter((p) => p.length >= 3);
        const hits = parts.filter((p) => name.includes(p)).length;
        if (hits > 0) score = 40 + hits * 10;
      }
      if (
        sessionCount != null &&
        extractSessionCountFromServiceName(service.name) === sessionCount
      ) {
        score += 50;
      }
      if (genericProfession && score < 90) {
        score = Math.min(score, 35);
      }
      return { service, score };
    })
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;
  const second = scored[1];
  if (second && second.score === top.score) return null;
  return top.service;
}

export type EnrichedEvolutionServiceSuggestion = EvolutionServiceSuggestion & {
  purchaseType: "SINGLE" | "PACKAGE";
  sessionCount: number;
  thisVisitIsPlanSession: boolean;
  /** Prefill + checkbox ligados por defeito quando o áudio afirma contratação. */
  autoAcceptRecommended: boolean;
  catalogMissing: boolean;
  commercialEvidence?: string;
  commercialCarePlan?: CommercialCarePlan;
  /** Prefill: áudio afirma pagamento já recebido. */
  paymentReceived?: boolean;
  paymentMethod?: CommercialPaymentMethod;
  /** Prefill de preço a partir do áudio (centavos); senão usar defaultPriceCents. */
  amountCents?: number;
  /** Hint UI: sessões já ocorridas citadas no áudio (sem inventar datas). */
  sessionsAlreadyDone?: number;
};

function amountReaisToCents(amountReais: number | undefined): number | undefined {
  if (amountReais == null || !Number.isFinite(amountReais) || amountReais <= 0) {
    return undefined;
  }
  return Math.round(amountReais * 100);
}

function commercialPaymentFields(commercial: CommercialCarePlan | undefined): {
  paymentReceived?: boolean;
  paymentMethod?: CommercialPaymentMethod;
  amountCents?: number;
  sessionsAlreadyDone?: number;
} {
  if (!commercial) return {};
  return {
    paymentReceived: commercial.paymentReceived,
    paymentMethod: commercial.paymentMethod,
    amountCents: amountReaisToCents(commercial.amountReais),
    sessionsAlreadyDone: commercial.sessionsAlreadyDone,
  };
}

/**
 * Cruza catálogo + sinal comercial (LLM e/ou heurística textual).
 */
export function buildEnrichedFinancialServiceSuggestion(
  text: string,
  services: Array<{ id: string; name: string; defaultPriceCents: number }>,
  commercialFromLlm?: CommercialCarePlan,
): EnrichedEvolutionServiceSuggestion | null {
  const fromText = detectCommercialCarePlanFromText(text);
  let commercial = mergeCommercialCarePlans(commercialFromLlm, fromText);

  // Reforça pagamento/valor a partir do texto mesmo quando a LLM trouxe só o plano.
  if (commercial) {
    const payment = inferPortuguesePayment({
      text,
      methodToken: commercial.paymentMethod,
    });
    commercial = {
      ...commercial,
      paymentReceived:
        commercial.paymentReceived ?? detectPaymentReceivedFromText(text),
      paymentMethod:
        commercial.paymentMethod ??
        (payment.method as CommercialPaymentMethod | null) ??
        undefined,
      amountReais: commercial.amountReais ?? extractAmountReaisFromText(text),
      sessionsAlreadyDone:
        commercial.sessionsAlreadyDone ?? detectSessionsAlreadyDoneFromText(text),
    };
  }

  const wantsPackage =
    commercial?.purchaseType === "PACKAGE" ||
    (commercial?.sessionCount != null && commercial.sessionCount >= 2) ||
    commercial?.contracted === true;

  const sessionCount =
    commercial?.sessionCount && commercial.sessionCount >= 2
      ? commercial.sessionCount
      : wantsPackage
        ? 8
        : 1;

  /** Ordem: nome literal no texto → N sessões no nome do catálogo → hint com sinónimos. */
  const catalogHit =
    detectEvolutionServiceSuggestion(text, services) ??
    (() => {
      if (wantsPackage && sessionCount >= 2) {
        const bySessions = matchServiceBySessionCount(sessionCount, services);
        if (bySessions) {
          return {
            serviceId: bySessions.id,
            serviceName: bySessions.name,
            defaultPriceCents: bySessions.defaultPriceCents,
            confidence: "CATALOG_TERM_EXACT" as const,
          };
        }
      }
      const byHint = matchServiceByHint(
        commercial?.serviceNameHint,
        services,
        wantsPackage ? sessionCount : undefined,
      );
      if (!byHint) return null;
      return {
        serviceId: byHint.id,
        serviceName: byHint.name,
        defaultPriceCents: byHint.defaultPriceCents,
        confidence: "CATALOG_TERM_EXACT" as const,
      };
    })();

  const purchaseType: "SINGLE" | "PACKAGE" = wantsPackage ? "PACKAGE" : "SINGLE";
  const thisVisitIsPlanSession = Boolean(
    commercial?.thisVisitIsPlanSession || (wantsPackage && commercial?.contracted),
  );
  const autoAcceptRecommended = Boolean(
    commercial?.contracted || (wantsPackage && catalogHit),
  );
  const paymentFields = commercialPaymentFields(commercial);

  if (!catalogHit) {
    if (!commercial?.contracted && !wantsPackage && !thisVisitIsPlanSession) {
      return null;
    }
    return {
      serviceId: "",
      serviceName: commercial?.serviceNameHint?.trim() || "Serviço do plano (sem match no catálogo)",
      defaultPriceCents: 0,
      confidence: "CATALOG_TERM_EXACT",
      purchaseType,
      sessionCount,
      thisVisitIsPlanSession,
      autoAcceptRecommended: false,
      catalogMissing: true,
      commercialEvidence: commercial?.evidence,
      commercialCarePlan: commercial,
      ...paymentFields,
    };
  }

  if (!commercial && !catalogHit) return null;

  return {
    ...catalogHit,
    purchaseType,
    sessionCount: purchaseType === "PACKAGE" ? sessionCount : 1,
    thisVisitIsPlanSession,
    autoAcceptRecommended,
    catalogMissing: false,
    commercialEvidence: commercial?.evidence,
    commercialCarePlan: commercial,
    ...paymentFields,
  };
}

export function commercialPlanReminderStorageKey(patientId: string): string {
  return `${PLAN_REMINDER_STORAGE_PREFIX}${patientId}`;
}

export function saveCommercialPlanReminder(
  patientId: string,
  payload: Omit<CommercialPlanReminderPayload, "createdAt">,
): void {
  if (typeof window === "undefined" || !patientId) return;
  try {
    const body: CommercialPlanReminderPayload = {
      ...payload,
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      commercialPlanReminderStorageKey(patientId),
      JSON.stringify(body),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function readCommercialPlanReminder(
  patientId: string,
): CommercialPlanReminderPayload | null {
  if (typeof window === "undefined" || !patientId) return null;
  try {
    const raw = window.localStorage.getItem(commercialPlanReminderStorageKey(patientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommercialPlanReminderPayload;
    if (!parsed?.createdAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function dismissCommercialPlanReminder(patientId: string): void {
  if (typeof window === "undefined" || !patientId) return;
  try {
    window.localStorage.removeItem(commercialPlanReminderStorageKey(patientId));
  } catch {
    /* ignore */
  }
}
