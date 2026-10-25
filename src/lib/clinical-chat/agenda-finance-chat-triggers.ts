/**
 * Termos que disparam contexto de Agenda ou Financeiro no chat clínico.
 * Só injetamos blocos quando o profissional usa linguagem explícita destas famílias.
 */

/** Padrões de agenda — marcações, comparecimento, confirmação, frequência de consultas */
export const AGENDA_CHAT_TRIGGER_PATTERNS: RegExp[] = [
  /\bagenda\b/i,
  /\bmarca(?:ç|c)(?:ã|a)õ?es?\b/i,
  /\bconsulta(?:s)?\s+agendada/i,
  /\bpr[óo]xima\s+consulta/i,
  /\bhor[áa]rio\s+(?:da\s+)?consulta/i,
  /\bcompareceu\b/i,
  /\bcomparecimento\b/i,
  /\bfaltou\b/i,
  /\bfalta\s+(?:à|a)\s+consulta/i,
  /\bn[ãa]o\s+(?:veio|compareceu|apareceu)\b/i,
  /\bconfirm(?:ar|ou|a)\s+(?:presen[çc]a|consulta)?/i,
  /\bpresen[çc]a\s+pendente/i,
  /\bcancelou\s+(?:a\s+)?consulta/i,
  /\bconsulta\s+cancelada/i,
  /\b(?:foi|est[áa])\s+realizada\b/i,
  /\bmarca(?:ç|c)(?:ã|a)o\s+(?:de|para|com)\b/i,
  /\bfrequ[êe]ncia\s+(?:de\s+)?(?:consultas?|atendimentos?|sess[õo]es?)\b/i,
  /\bquantas\s+(?:consultas?|sess[õo]es?|vezes)\s+(?:agendadas?|marcadas?|atendeu)\b/i,
  /\b(?:última|ultima|pr[óo]xima)\s+(?:consulta|sess[ãa]o|marca(?:ç|c)(?:ã|a)o)\b/i,
];

/** Padrões financeiros — pagamento, pacote, caixa, sessões restantes */
export const FINANCE_CHAT_TRIGGER_PATTERNS: RegExp[] = [
  /\bpag(?:ou|amento|ar)\b/i,
  /\bfinanceiro\b/i,
  /\b(?:receita|caixa)\s+(?:do\s+)?paciente/i,
  /\bvalor\s+(?:combinado|acordado|pago)\b/i,
  /\bpacote\s+(?:de\s+)?sess[õo]es?\b/i,
  /\bsess[õo]es?\s+(?:restantes?|pendentes?|do\s+pacote)\b/i,
  /\b(?:comprou|venda|vendeu)\s+(?:o\s+)?(?:pacote|servi[çc]o)/i,
  /\bquanto\s+(?:pagou|deve|falta\s+pagar)\b/i,
  /\bforma\s+de\s+pagamento\b/i,
  /\b(?:pix|cart[ãa]o|dinheiro)\b/i,
  /\blan[çc]amento\s+(?:financeiro|no\s+caixa)/i,
  /\b(?:d[éé]bito|cr[ée]dito)\s+(?:de\s+)?sess[ãa]o/i,
  /\bsess[ãa]o\s+(?:consumida|pendente)\b/i,
  /\bpre[çc]o\s+(?:combinado|do\s+pacote|acordado)\b/i,
];

export type AgendaFinanceChatTriggerResult = {
  wantsAgendaContext: boolean;
  wantsFinanceContext: boolean;
};

export function detectAgendaFinanceChatTriggers(
  userQuestion: string,
): AgendaFinanceChatTriggerResult {
  const text = userQuestion.trim();
  if (!text) {
    return { wantsAgendaContext: false, wantsFinanceContext: false };
  }
  return {
    wantsAgendaContext: AGENDA_CHAT_TRIGGER_PATTERNS.some((p) => p.test(text)),
    wantsFinanceContext: FINANCE_CHAT_TRIGGER_PATTERNS.some((p) => p.test(text)),
  };
}
