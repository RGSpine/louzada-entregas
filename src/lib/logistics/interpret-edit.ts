import { normalizePtExpression } from "@/lib/schedule-temporal-parse";

import { resolveLogisticsDate, resolveLogisticsTime } from "@/lib/logistics/temporal-resolve";

const EDIT_CUE =
  /\b(muda|mudar|altere|altera|alterar|troca|trocar|adia|adiar|antecipa|antecipar|remarca|remarcar|corrige|corrigir|tira|tirar|remove|remover|retira|retirar|passa a ser|passa para)\b/;

const DATE_WORD =
  "depois de amanha|semana que vem(?:\\s+(?:na|nesta))?\\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?|semana que vem|(?:proxima|essa|esta|nesta)\\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?|hoje|ontem|amanha|(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{4}-\\d{2}-\\d{2}";

export type LogisticsEditIntent = {
  matchType: "ENTREGA" | "COLETA" | null;
  matchClientName: string;
  matchDate: string | null;
  type: "ENTREGA" | "COLETA" | null;
  clientName: string | null;
  courierName: string | null;
  clearCourier: boolean;
  targetDate: string | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
};

function titleName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function asType(word: string | undefined): "ENTREGA" | "COLETA" | null {
  if (word === "coleta") return "COLETA";
  if (word === "entrega") return "ENTREGA";
  return null;
}

function pickSubjectClient(source: string): string | null {
  const found = source.match(/\b(?:coleta|entrega)\s+d[aeo]\s+(?:dr\.?\s*|doutora?\s+)?([a-z0-9][a-z0-9' .-]{1,80})/);
  if (!found?.[1]) return null;
  const name = found[1]
    .replace(/\b(para|passa|de|hoje|ontem|amanha|ate|as|semana)\b.*$/, "")
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || /^(dr|doutor|doutora)$/.test(name)) return null;
  return titleName(name);
}

function pickPerson(raw: string): string | null {
  const blocked = new Set(["ira", "vai", "para", "pra", "coletar", "coleta", "entregar", "entrega", "cliente", "entregador"]);
  const name = raw
    .replace(new RegExp(`\\b(?:${DATE_WORD})\\b.*$`), "")
    .replace(/\b(?:das|entre|ate|as)\b.*$/, "")
    .replace(/\bcom o entregador\b.*$/, "")
    .replace(/^(?:o|a|dr|doutor|doutora)\s+/, "")
    .replace(/[.,;:!?]+/g, " ")
    .replace(/[^a-z0-9' .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || blocked.has(name)) return null;
  return titleName(name);
}

function pickWindow(text: string): { start: string | null; end: string | null } {
  const window = text.match(/\b(?:das|entre)\s+(.+?)\s+(?:as|ate|e)\s+(.+?)$/);
  if (window) {
    return { start: resolveLogisticsTime(window[1]), end: resolveLogisticsTime(window[2]) };
  }
  const until = text.match(/\bate\s+(?:as\s+|a\s+)?(.+?)$/);
  const clock = until ?? text.match(/\bas\s+(.+?)$/);
  if (!clock?.[1]) return { start: null, end: null };
  return { start: null, end: resolveLogisticsTime(clock[1]) };
}

function interpretClause(clause: string, now: Date): LogisticsEditIntent | null {
  const normalized = normalizePtExpression(clause);
  if (!EDIT_CUE.test(normalized)) return null;

  const clearCourier = /\b(tira|remove|retira|retire)\b.{0,40}\bentregador\b|\bsem entregador\b/.test(normalized);
  const [source = "", destination = ""] = normalized.split(/\b(?:para|passa a ser)\b/);
  const dest = destination.trim();
  const matchClientName = pickSubjectClient(source);
  if (!matchClientName) return null;

  const sourceType = asType(source.match(/\b(coleta|entrega)\b/)?.[1]);
  const destType = asType(dest.match(/^(coleta|entrega)\b/)?.[1]);
  const changingClient = /\b(?:muda|mudar|troca|trocar|altera|alterar|corrige|corrigir)\s+o\s+cliente\b/.test(source);
  const changingCourier = /\b(?:muda|mudar|troca|trocar|altera|alterar|corrige|corrigir)\s+o\s+entregador\b/.test(source);
  const fromDate = source.match(new RegExp(`\\bde\\s+(${DATE_WORD})\\b`));
  const toDate = dest.match(new RegExp(`\\b(${DATE_WORD})\\b`));
  const window = pickWindow(dest);
  const courierInDest = dest.match(/\bentregador\s+([a-z][a-z' ]{1,60})/);
  const courierName = changingCourier
    ? pickPerson(dest)
    : courierInDest?.[1]
      ? pickPerson(courierInDest[1])
      : null;
  const clientName = changingClient ? pickPerson(dest) : null;

  const intent: LogisticsEditIntent = {
    matchType: sourceType,
    matchClientName,
    matchDate: resolveLogisticsDate(fromDate?.[1], now),
    type: destType && destType !== sourceType ? destType : null,
    clientName,
    courierName,
    clearCourier,
    targetDate: resolveLogisticsDate(toDate?.[1], now),
    timeWindowStart: window.start,
    timeWindowEnd: window.end,
  };
  const changed =
    intent.type != null ||
    intent.clientName != null ||
    intent.courierName != null ||
    intent.clearCourier ||
    intent.targetDate != null ||
    intent.timeWindowStart != null ||
    intent.timeWindowEnd != null;
  return changed ? intent : null;
}

export function transcriptHasEditCue(transcript: string): boolean {
  return EDIT_CUE.test(normalizePtExpression(transcript));
}

/** Uma frase de alteração vira a marcação que deve ser encontrada e o que muda nela. */
export function interpretLogisticsEdits(transcript: string, now: Date): LogisticsEditIntent[] {
  return transcript
    .split(/\s*[/;]\s*/)
    .flatMap((chunk) => chunk.split(/\s+\be\s+(?=(?:muda|troca|altera|adia|a coleta|a entrega|o entregador|o cliente)\b)/))
    .map((clause) => interpretClause(clause.trim(), now))
    .filter((intent): intent is LogisticsEditIntent => intent != null);
}
