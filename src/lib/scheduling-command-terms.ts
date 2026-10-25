/**
 * Léxico pt-BR de comandos de agenda por voz/OCR.
 *
 * Camada determinística que complementa a extração da LLM: o modelo continua
 * responsável por extrair nome/data/hora, mas a classificação do verbo é
 * verificável aqui e serve de correção quando o modelo devolve "create" para
 * uma frase que na verdade pede remarcação ou cancelamento.
 */

export type SchedulingCommandKind =
  | "create"
  | "reschedule"
  | "cancel"
  | "rename"
  | "yield"
  | "no_show";

export function normalizeCommandText(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Radicais de verbo inequívocos. A fronteira `\b` à esquerda é o que impede
 * colisão entre famílias: "desmarcar" não casa `\bmarc` e "reagendar" não casa
 * `\bagend`, porque não há fronteira de palavra no meio do termo.
 */
const CANCEL_VERBS = ["desmarc", "desmarqu", "cancel", "anul"];
const RESCHEDULE_VERBS = ["remarc", "remarqu", "reagend", "reescalon"];
const CREATE_VERBS = ["marc", "marqu", "agend", "encaix", "reserv"];

/**
 * Radicais genéricos: só contam com substantivo de agenda ou destino "para ..." por perto.
 *
 * Verbos em -car mudam a grafia no imperativo ("trocar" → "troque"), por isso
 * precisam dos dois radicais — como em "marcar"/"marque" acima.
 */
const WEAK_CANCEL_VERBS = ["exclu", "apag", "remov", "tir", "suspend", "desist", "abort"];
const WEAK_RESCHEDULE_VERBS = [
  "transf",
  "adia",
  "adie",
  "anteci",
  "mud",
  "troc",
  "troqu",
  "mov",
  "alter",
  "pass",
  "empurr",
  "realoc",
  "realoqu",
];

/** Frases de yield / ociosidade no marketplace. */
const YIELD_PHRASES = [
  "pro desconto",
  "para o desconto",
  "joga pro",
  "joga esse horario",
  "horario vago",
  "coloca no yield",
  "gestao inteligente",
  "ociosidade",
];

/**
 * Falta justificada (NO_SHOW) — paciente não compareceu / desistiu em cima da hora.
 * Diferente de «desmarque/cancele» (retirar da agenda sem registro de falta).
 */
const NO_SHOW_PHRASES = [
  "marque falta",
  "marcar falta",
  "marca falta",
  "registre falta",
  "registrar falta",
  "registra falta",
  "registar falta",
  "falta justificada",
  "nao compareceu",
  "nao comparecera",
  "nao veio",
  "nao vem",
  "nao vai vir",
  "nao vira",
  "nao podera vir",
  "nao pode vir",
  "nao vai poder",
  "deu para tras",
  "deu pra tras",
];

const NO_SHOW_PATTERNS = [
  /\bfaltou\b/,
  /\bfaltaram\b/,
  /\bfalta\s+(?:da|do|de)\b/,
  /\bmarc(?:ar|e|a)\s+(?:a\s+)?falta\b/,
  /\bregistr(?:ar|e|a)\s+(?:a\s+)?falta\b/,
];

/** Frases fixas que indicam cancelamento sem verbo de agenda. */
const CANCEL_PHRASES: string[] = [];

/**
 * Renomear o rótulo do evento/paciente na agenda — antes dos fracos "mud/troc",
 * que senão classificam "mude o nome" como remarcação.
 */
const RENAME_PATTERNS = [
  /\brenome(?:ar|ie|ia|iem|ando)\b/,
  /\bcorrig(?:ir|a|indo)\s+(?:o\s+)?nome\b/,
  /\b(?:mudar|mude|trocar|troque|alterar|altere)\s+o\s+nome\b/,
  /\bcolocar\s+o\s+nome\b/,
  /\bchamar\s+(?:de|o\s+evento|o\s+compromisso)\b/,
];

function isRenameCommand(normalized: string): boolean {
  return RENAME_PATTERNS.some((re) => re.test(normalized));
}

/** Substantivos que, isolados, já expressam o ato de marcar ("nova marcação"). */
const BOOKING_NOUNS = [
  "marcacao",
  "marcacoes",
  "agendamento",
  "agendamentos",
  "encaixe",
  "encaixes",
];

/** Substantivos que dão contexto de agenda a verbos genéricos. */
const AGENDA_NOUNS = [
  ...BOOKING_NOUNS,
  "consulta",
  "consultas",
  "sessao",
  "sessoes",
  "horario",
  "horarios",
  "atendimento",
  "atendimentos",
  "retorno",
  "retornos",
  "compromisso",
  "compromissos",
  "agenda",
];

const AGENDA_NOUN_SET = new Set(AGENDA_NOUNS);
const BOOKING_NOUN_SET = new Set(BOOKING_NOUNS);

function tokenize(normalized: string): string[] {
  return normalized.split(/[^a-z0-9]+/).filter(Boolean);
}

function matchesStem(text: string, stems: string[]): boolean {
  return stems.some((stem) => new RegExp(`\\b${stem}`).test(text));
}

/**
 * Verbo de criação de fato, ignorando tokens que são apenas substantivos de
 * agenda — "marcação" e "agendamento" partilham radical com "marcar"/"agendar".
 */
function hasCreateVerb(tokens: string[]): boolean {
  return tokens.some(
    (token) =>
      !AGENDA_NOUN_SET.has(token) && CREATE_VERBS.some((stem) => token.startsWith(stem)),
  );
}

/** Contexto que valida radicais genéricos: substantivo de agenda ou destino "para <algo>". */
function hasAppointmentContext(normalized: string, tokens: string[]): boolean {
  if (tokens.some((token) => AGENDA_NOUN_SET.has(token))) return true;
  return /\b(para|pra|pro)\s+\S/.test(normalized);
}

function isNoShowCommand(normalized: string): boolean {
  if (NO_SHOW_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return NO_SHOW_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Classifica a intenção do comando.
 *
 * Ordem: falta justificada → cancelar → remarcar → verbo de criar → genéricos
 * com contexto → substantivo de marcação. Falta vem antes de cancelar para que
 * «não vem» / «faltou» não caiam em desmarcar; cancelar/remarcar vêm antes de
 * criar para frases compostas ("desmarque a consulta que agendei").
 *
 * Devolve null quando nenhum termo de agenda é reconhecido.
 */
export function detectSchedulingCommandKind(
  text: string | null | undefined,
): SchedulingCommandKind | null {
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;
  const tokens = tokenize(normalized);

  if (isNoShowCommand(normalized)) return "no_show";

  if (
    matchesStem(normalized, CANCEL_VERBS) ||
    CANCEL_PHRASES.some((phrase) => normalized.includes(phrase))
  ) {
    return "cancel";
  }
  // Antes de remarcar/criar: "mude o nome do FECHADO para Eric".
  if (isRenameCommand(normalized)) return "rename";
  if (matchesStem(normalized, RESCHEDULE_VERBS)) return "reschedule";
  if (YIELD_PHRASES.some((phrase) => normalized.includes(phrase))) return "yield";
  if (hasCreateVerb(tokens)) return "create";

  if (hasAppointmentContext(normalized, tokens)) {
    if (matchesStem(normalized, WEAK_CANCEL_VERBS)) return "cancel";
    if (matchesStem(normalized, WEAK_RESCHEDULE_VERBS)) return "reschedule";
  }

  if (tokens.some((token) => BOOKING_NOUN_SET.has(token))) return "create";

  return null;
}

/**
 * Reconcilia a ação da LLM com o léxico. O modelo tende a devolver "create"
 * por ser o caso mais frequente; quando o texto tem verbo explícito de
 * remarcação/cancelamento/falta, o léxico corrige.
 *
 * Exceção: se o léxico detecta "no_show", corrige também um "cancel" errado
 * do modelo («não vem» / «faltou» ≠ desmarcar).
 */
export function reconcileSchedulingAction(params: {
  modelAction: string | null | undefined;
  transcript: string | null | undefined;
}): SchedulingCommandKind | null {
  const { modelAction, transcript } = params;
  const detected = detectSchedulingCommandKind(transcript);

  // Falta justificada tem prioridade sobre cancel equivocado do modelo.
  if (detected === "no_show" && (modelAction === "cancel" || modelAction === "create")) {
    return "no_show";
  }

  if (
    modelAction === "cancel" ||
    modelAction === "reschedule" ||
    modelAction === "rename" ||
    modelAction === "yield" ||
    modelAction === "no_show"
  ) {
    return modelAction;
  }

  if (modelAction === "create") {
    return detected === "cancel" ||
      detected === "reschedule" ||
      detected === "rename" ||
      detected === "yield" ||
      detected === "no_show"
      ? detected
      : "create";
  }

  // Modelo omitiu ação / ambiguous: léxico pode recuperar a operação.
  if (
    detected === "rename" ||
    detected === "cancel" ||
    detected === "reschedule" ||
    detected === "yield" ||
    detected === "no_show"
  ) {
    return detected;
  }

  return null;
}

export function describeSchedulingCommandKind(kind: SchedulingCommandKind): string {
  switch (kind) {
    case "create":
      return "marcação";
    case "reschedule":
      return "remarcação";
    case "cancel":
      return "desmarcação";
    case "rename":
      return "renomeação";
    case "yield":
      return "oferta de ociosidade";
    case "no_show":
      return "falta justificada";
  }
}
