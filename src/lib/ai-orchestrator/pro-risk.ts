/**
 * Classificador R0/R1/R2 para superfície profissional (Ester, agenda).
 * Regras — zero LLM. Empate → R1.
 */

import type { OrchestratorDecisionBase, OrchestratorRisk } from "./types";
import { detectAgendaFinanceChatTriggers } from "@/lib/clinical-chat/agenda-finance-chat-triggers";

export type ProOrchestratorIntent =
  | "emergency"
  | "agenda_finance"
  | "chart_lookup"
  | "product_faq"
  | "clinical"
  | "exam_file";

export type ProOrchestratorDecision = OrchestratorDecisionBase & {
  intent: ProOrchestratorIntent;
  wantsAgenda: boolean;
  wantsFinance: boolean;
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EMERGENCY_PATTERNS: RegExp[] = [
  /\bfalta de ar\b/,
  /\bdor no peito\b/,
  /\bdor toracica\b/,
  /\bsangramento (intenso|abundante)\b/,
  /\bdesmai/,
  /\bconvulsao\b/,
  /\bemergencia\b/,
  /\bpronto[- ]?socorro\b/,
  /\bSAMU\b/i,
  /\bideacao suicida\b/,
  /\brisco de vida\b/,
];

const CHART_LOOKUP_PATTERNS: RegExp[] = [
  /\bliste?\b/,
  /\bquais (sao|são|foram)\b/,
  /\bresuma (as |os )?(ultimas|últimas|evolucoes|evoluções)\b/,
  /\bmedicamentos?\b/,
  /\bsuplementos?\b/,
  /\bultima evolucao\b/,
  /\búltima evolução\b/,
  /\bo que ja (foi|esta|está) (registrado|no prontuario|no prontuário)\b/,
  /\bhistorico (do|da) paciente\b/,
  /\bhistórico (do|da) paciente\b/,
];

const EXAM_FILE_PATTERNS: RegExp[] = [
  /\banalise (o |este |esse )?(exame|pdf|laudo|arquivo)\b/,
  /\banálise (o |este |esse )?(exame|pdf|laudo|arquivo)\b/,
  /\bleia (o |este )?(exame|pdf|laudo)\b/,
  /\bna pasta de exames\b/,
];

const PRODUCT_FAQ_PATTERNS: RegExp[] = [
  /\bo que e a ester\b/,
  /\bo que é a ester\b/,
  /\bcomo funciona a (ester|nova evolucao|nova evolução)\b/,
  /\bcomo marcar (consulta )?por voz\b/,
];

const CLINICAL_REASONING_PATTERNS: RegExp[] = [
  /\bevidencia\b/,
  /\bevidência\b/,
  /\bguideline\b/,
  /\bdiretriz/,
  /\bpubmed\b/,
  /\bdiagnostico diferencial\b/,
  /\bdiagnóstico diferencial\b/,
  /\bprognostico\b/,
  /\bprognóstico\b/,
  /\bconduta (sugerida|recomendada)\b/,
  /\bo que (diz|sugerem) (os )?estudos\b/,
  /\bcompar(ar|e) (tratamentos|condutas)\b/,
];

function routeFor(risk: OrchestratorRisk): OrchestratorDecisionBase["route"] {
  if (risk === "R2") return "zero_llm";
  if (risk === "R0") return "Modelo_Economico";
  return "Modelo_Avancado";
}

/**
 * Classifica a pergunta do profissional no chat clínico / agenda.
 */
export function classifyProOrchestratorRisk(
  userText: string,
): ProOrchestratorDecision {
  const n = normalize(userText);
  const triggers = detectAgendaFinanceChatTriggers(userText);

  if (!n) {
    return {
      risk: "R0",
      route: "Modelo_Economico",
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: false,
      intent: "chart_lookup",
      wantsAgenda: false,
      wantsFinance: false,
    };
  }

  if (EMERGENCY_PATTERNS.some((p) => p.test(n))) {
    return {
      risk: "R2",
      route: routeFor("R2"),
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: false,
      intent: "emergency",
      wantsAgenda: triggers.wantsAgendaContext,
      wantsFinance: triggers.wantsFinanceContext,
    };
  }

  if (PRODUCT_FAQ_PATTERNS.some((p) => p.test(n))) {
    return {
      risk: "R0",
      route: "zero_llm",
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: false,
      intent: "product_faq",
      wantsAgenda: false,
      wantsFinance: false,
    };
  }

  if (EXAM_FILE_PATTERNS.some((p) => p.test(n))) {
    return {
      risk: "R1",
      route: "Modelo_Avancado",
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: true,
      intent: "exam_file",
      wantsAgenda: triggers.wantsAgendaContext,
      wantsFinance: triggers.wantsFinanceContext,
    };
  }

  const clinicalReasoning = CLINICAL_REASONING_PATTERNS.some((p) => p.test(n));
  const chartLookup = CHART_LOOKUP_PATTERNS.some((p) => p.test(n));
  const onlyOps =
    (triggers.wantsAgendaContext || triggers.wantsFinanceContext) &&
    !clinicalReasoning &&
    !EXAM_FILE_PATTERNS.some((p) => p.test(n));

  if (onlyOps) {
    return {
      risk: "R0",
      route: "Modelo_Economico",
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: false,
      intent: "agenda_finance",
      wantsAgenda: triggers.wantsAgendaContext,
      wantsFinance: triggers.wantsFinanceContext,
    };
  }

  if (chartLookup && !clinicalReasoning) {
    return {
      risk: "R0",
      route: "Modelo_Economico",
      surface: "pro",
      skipEvidence: true,
      wantsHeavyContext: false,
      intent: "chart_lookup",
      wantsAgenda: triggers.wantsAgendaContext,
      wantsFinance: triggers.wantsFinanceContext,
    };
  }

  return {
    risk: "R1",
    route: "Modelo_Avancado",
    surface: "pro",
    skipEvidence: false,
    wantsHeavyContext: true,
    intent: "clinical",
    wantsAgenda: triggers.wantsAgendaContext,
    wantsFinance: triggers.wantsFinanceContext,
  };
}

export const PRO_EMERGENCY_HINT =
  "Sinais de gravidade mencionados — priorize orientação de emergência/pronto-socorro conforme o caso; a Ester não substitui avaliação presencial urgente.";
