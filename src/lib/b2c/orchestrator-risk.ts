/**
 * Classificador R0/R1/R2 do Orquestrador B2C (Fase A — só regras, zero LLM).
 * Fonte: docs/AI-ORCHESTRATOR-TOKEN-ECONOMY.md
 */

export type B2cRiskLevel = "R0" | "R1" | "R2";

export type B2cOrchestratorIntent =
  | "emergency"
  | "tasks"
  | "schedule"
  | "vitrine"
  | "product_faq"
  | "clinical"
  | "general_ops";

export type B2cOrchestratorDecision = {
  risk: B2cRiskLevel;
  intent: B2cOrchestratorIntent;
  /** Incluir catálogo da vitrine no manager / prompt. */
  wantsProfessional: boolean;
  /** Pode resolver com Prisma (tarefas / retornos). */
  wantsTasksOrSchedule: boolean;
  /** FAQ de produto canônico (sem PHI). */
  wantsProductFaq: boolean;
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
  /\bdificuldade para respirar\b/,
  /\bdor no peito\b/,
  /\bdor toracica\b/,
  /\bsangramento (intenso|muito|abundante)\b/,
  /\bdesmaiei\b/,
  /\bdesmaiando\b/,
  /\bconvulsao\b/,
  /\bnao consigo mexer\b/,
  /\bparalisi[sa]\b/,
  /\bsuicid/,
  /\bme matar\b/,
  /\bemergencia\b/,
  /\bpronto[- ]?socorro\b/,
  /\bambulancia\b/,
];

const PRODUCT_FAQ_PATTERNS: RegExp[] = [
  /\bcomo (funciona|usar|abrir) (o )?(mapa|assessor|chat)\b/,
  /\bo que (e|é) o mapa de saude\b/,
  /\b(lgpd|privacidade|meus dados)\b/,
  /\bsubstitui (uma )?consulta\b/,
  /\bnao substitui consulta\b/,
  /\bcomo (envio|mandar|anexar) (um )?exame\b/,
  /\bcomo (gravo|gravar) (a )?consulta\b/,
];

const TASK_PATTERNS: RegExp[] = [
  /\btarefa/,
  /\bpendente/,
  /\blembrete/,
  /\bmedicacao\b/,
  /\bremedio\b/,
  /\bcomprimido/,
  /\bhorario do remedio\b/,
  /\bexame (marcado|pendente|agendado)\b/,
  /\bretorno\b/,
  /\bproxima consulta\b/,
  /\bproximo (exame|retorno|horario)\b/,
  /\bquando (e|é|tenho|sera|será) (meu |o )?(retorno|exame|consulta)\b/,
  /\bo que (tenho|preciso) (fazer|tomar)\b/,
];

const SCHEDULE_VITRINE_PATTERNS: RegExp[] = [
  /\bvitrine\b/,
  /\bprofissional(es)?\b/,
  /\bespecialista\b/,
  /\bmarcar (consulta|horario|retorno)\b/,
  /\bagendar\b/,
  /\bhorario disponivel\b/,
  /\breservar\b/,
  /\bdesconto\b/,
  /\byield\b/,
  /\bquem (me )?(atende|indicar|recomendar)\b/,
  /\bindica(r|cao|coes)? (um |uma )?(medico|fisio|nutri|psicologo)\b/,
  /\b(fisioterapeuta|nutricionista|psicologo|medico|dentista)\b/,
];

const CLINICAL_PATTERNS: RegExp[] = [
  /\bdor\b/,
  /\bsintoma/,
  /\blaudo\b/,
  /\bexame\b/,
  /\bdiagnostico\b/,
  /\bresultado/,
  /\binflam/,
  /\bfebre\b/,
  /\bnause/,
  /\btontura\b/,
  /\binsonia\b/,
  /\bansiedade\b/,
  /\bdepressao\b/,
  /\bpressao\b/,
  /\bglicemia\b/,
  /\bcolesterol\b/,
  /\btratamento\b/,
  /\befeito (colateral|adverso)\b/,
  /\be normal\b/,
  /\be perigoso\b/,
  /\bo que significa\b/,
  /\bminha (consulta|evolucao|evolução)\b/,
  /\bresumo (da |do )?(consulta|exame|laudo)\b/,
];

/**
 * Classifica a entrada do paciente B2C para o orquestrador.
 * Empate clínico vs operacional → R1 (segurança).
 */
export function classifyB2cOrchestratorRisk(
  userText: string,
): B2cOrchestratorDecision {
  const n = normalize(userText);
  if (!n) {
    return {
      risk: "R0",
      intent: "general_ops",
      wantsProfessional: false,
      wantsTasksOrSchedule: false,
      wantsProductFaq: false,
    };
  }

  if (EMERGENCY_PATTERNS.some((p) => p.test(n))) {
    return {
      risk: "R2",
      intent: "emergency",
      wantsProfessional: false,
      wantsTasksOrSchedule: false,
      wantsProductFaq: false,
    };
  }

  const wantsProductFaq = PRODUCT_FAQ_PATTERNS.some((p) => p.test(n));
  const wantsTasksOrSchedule = TASK_PATTERNS.some((p) => p.test(n));
  const wantsProfessional = SCHEDULE_VITRINE_PATTERNS.some((p) => p.test(n));
  const clinical = CLINICAL_PATTERNS.some((p) => p.test(n));

  // "exame" aparece em task e clinical — se for só "próximo exame"/tarefa, fica R0
  const examIsScheduleOnly =
    /\b(proximo|proxima|quando|marcado|pendente|agendado|retorno)\b/.test(n) &&
    /\bexame\b/.test(n) &&
    !/\b(resultado|laudo|significa|alterad)\b/.test(n);

  if (clinical && !examIsScheduleOnly && !wantsProductFaq) {
    // Pedido de profissional + clínica = R1 com vitrine
    return {
      risk: "R1",
      intent: "clinical",
      wantsProfessional: wantsProfessional || /\bindic/.test(n),
      wantsTasksOrSchedule,
      wantsProductFaq: false,
    };
  }

  if (wantsProductFaq) {
    return {
      risk: "R0",
      intent: "product_faq",
      wantsProfessional: false,
      wantsTasksOrSchedule: false,
      wantsProductFaq: true,
    };
  }

  if (wantsTasksOrSchedule && !wantsProfessional) {
    return {
      risk: "R0",
      intent: "tasks",
      wantsProfessional: false,
      wantsTasksOrSchedule: true,
      wantsProductFaq: false,
    };
  }

  if (wantsProfessional && !clinical) {
    return {
      risk: "R0",
      intent: "vitrine",
      wantsProfessional: true,
      wantsTasksOrSchedule: wantsTasksOrSchedule,
      wantsProductFaq: false,
    };
  }

  if (wantsTasksOrSchedule || wantsProfessional) {
    return {
      risk: "R0",
      intent: wantsProfessional ? "vitrine" : "schedule",
      wantsProfessional,
      wantsTasksOrSchedule,
      wantsProductFaq: false,
    };
  }

  // Ambíguo / conversacional → R1 (assessor clínico leve)
  return {
    risk: "R1",
    intent: "clinical",
    wantsProfessional: false,
    wantsTasksOrSchedule: false,
    wantsProductFaq: false,
  };
}

/** Texto fixo de emergência — sem LLM, sem vitrine. */
export const B2C_EMERGENCY_CANONICAL_REPLY =
  "Pelos sinais que você descreveu, isto pode ser urgente. Procure imediatamente um pronto-socorro ou ligue para o serviço de emergência da sua região (SAMU 192). Este assistente não substitui atendimento médico de emergência.";
