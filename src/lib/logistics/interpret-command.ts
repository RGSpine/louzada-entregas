import { normalizePtExpression } from "@/lib/schedule-temporal-parse";

import type { LogisticsTaskDraft } from "@/lib/logistics/intake-schema";
import { hearLogisticsMoney } from "@/lib/logistics/money";
import { PERSON_TITLE_PATTERN } from "@/lib/logistics/person-name";
import { resolveLogisticsDate, resolveLogisticsTime } from "@/lib/logistics/temporal-resolve";

const OPTIONAL_TITLE = `(?:${PERSON_TITLE_PATTERN})?`;
const CLIENT_PREP = "(?:no|na|em|do|da|pro|pra|para|ao)";
const NAME_BLOCK_SOURCE =
  "amanha|hoje|ontem|semana|tarde|manha|noite|hora|horas|entregador|motoboy|cliente|paciente|quem|fara|faria|vai|vou|vamos|ira|faz|para|pra|pro|que|com|ate|entrega|entregar|coleta|coletar|doutor|doutora|dentista|profissional|professor|professora|dr|dra|pix|dinheiro|cartao";
const NAME_BLOCK = new Set(NAME_BLOCK_SOURCE.split("|"));
const NAME_ATOM = `(?!(?:${NAME_BLOCK_SOURCE})\\b)[a-z][a-z']{1,40}`;
const HEARD_NAME = `${NAME_ATOM}(?:\\s+(?:da|de|do|das|dos)\\s+${NAME_ATOM}|\\s+${NAME_ATOM}){0,3}`;

const DATE_PATTERNS: RegExp[] = [
  /\bsemana que vem(?:\s+(?:na|nesta))?\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b/,
  /\bsemana que vem\b/,
  /\bsemana passada\b/,
  /\bdepois de amanha\b/,
  /\b(?:proxima|essa|esta|nesta)\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b/,
  /\b(?:hoje|ontem|amanha)\b/,
  /\b(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
];

function titleName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** "Irá entregar" e "quem fará a entrega" continuam a mesma ordem. Outra ordem precisa de data, cliente ou horário. */
function clauseOpensAnotherOrder(before: string, fromVerb: string): boolean {
  const tail = normalizePtExpression(before).replace(/[.,]/g, " ").replace(/\s+/g, " ").slice(-80);
  const courierContinues =
    /\b(?:entregador|motoboy|moto boy)\b/.test(tail) && /\b(?:ira|vai|vou|vamos)\s*$/.test(tail);
  const deliveryNoun = /\b(?:quem|fara|faz|faria)\s+(?:a|o)?\s*$/.test(tail);
  if (courierContinues || deliveryNoun) return false;

  const text = normalizePtExpression(fromVerb);
  if (pickDateExpression(text)) return true;
  if (new RegExp(`\\b${CLIENT_PREP}\\s+(?:(?:o|a|ao)\\s+)?(?:(?:cliente|paciente)\\s+)?${OPTIONAL_TITLE}[a-z]`).test(text)) {
    return true;
  }
  if (/\bate\b/.test(text) || resolveLogisticsTime(text)) return true;
  return false;
}

/** "a entrega" e "uma coleta" são o serviço, não um segundo comando. */
function isDeliveryNoun(chunk: string, index: number, word: string): boolean {
  if (!/^(?:entrega|coleta)$/i.test(word)) return false;
  const before = normalizePtExpression(chunk.slice(Math.max(0, index - 24), index)).replace(/[.,]/g, " ");
  return /\b(?:a|o|uma|um)\s*$/.test(before);
}

export function splitLogisticsClauses(transcript: string): string[] {
  const chunks = transcript
    .split(/\s*\/\s*/)
    .flatMap((chunk) =>
      chunk.split(/\s+(?=(?:e\s+)?(?:hoje|ontem|amanh[aã]|semana)\b[^.]{0,80}\b(?:colet(?:a|ar)|entreg(?:a|ar))\b)/i),
    )
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  for (const chunk of chunks) {
    const marks = [...chunk.matchAll(/\b(colet(?:a|ar|ando|ou)|entreg(?:a|ar|ando|ou))\b/gi)].filter(
      (mark) => !isDeliveryNoun(chunk, mark.index ?? 0, mark[1] ?? ""),
    );
    const cuts = marks.filter((mark, index) => {
      if (index === 0) return true;
      const at = mark.index ?? 0;
      return clauseOpensAnotherOrder(chunk.slice(0, at), chunk.slice(at));
    });
    if (cuts.length <= 1) {
      clauses.push(chunk);
      continue;
    }
    let cursor = 0;
    for (let i = 1; i < cuts.length; i += 1) {
      const at = cuts[i]?.index ?? chunk.length;
      clauses.push(chunk.slice(cursor, at).trim());
      cursor = at;
    }
    clauses.push(chunk.slice(cursor).trim());
  }
  return clauses.filter(Boolean);
}

function pickDateExpression(normalized: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const found = normalized.match(pattern);
    if (found?.[0]) return found[0];
  }
  return null;
}

function trimHeardName(raw: string): string | null {
  let name = raw
    .replace(
      /\b(para|pra|pro|no|na|em|que|vai|vou|vamos|ira|coletar|coleta|entregar|entrega|ate|as|quem|fara|faz|faria|hoje|ontem|amanha|semana|servico|reais|real|pix|dinheiro|cartao|transferencia|pago|pagou|valor)\b.*$/,
      "",
    )
    .replace(/[^a-z' .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  name = name
    .replace(/^(?:cliente|paciente|doutor|doutora|dentista|profissional|professor|professora|dr|dra)\s+/, "")
    .replace(/^(?:cliente|paciente|doutor|doutora|dentista|profissional|professor|professora|dr|dra)\s+/, "")
    .trim();
  const first = name.split(/\s+/)[0] ?? "";
  if (!name || NAME_BLOCK.has(first)) return null;
  return titleName(name);
}

function pickClient(normalized: string): string | null {
  const patterns = [
    new RegExp(
      `\\b${CLIENT_PREP}\\s+(?:(?:o|a|ao)\\s+)?(?:(?:cliente|paciente)\\s+)?${OPTIONAL_TITLE}(${HEARD_NAME})`,
      "g",
    ),
    new RegExp(`\\b(?:${PERSON_TITLE_PATTERN})(${HEARD_NAME})`, "g"),
  ];
  const found: { index: number; name: string }[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const name = trimHeardName(match[1] ?? "");
      if (!name || match.index == null) continue;
      found.push({ index: match.index, name });
    }
  }
  found.sort((left, right) => left.index - right.index);
  return found.at(-1)?.name ?? null;
}

function pickWork(normalized: string): string | null {
  const found = normalized.match(/\bservico\s+(?:d[aeo]\s+)?(?:paciente\s+)?([a-z0-9][a-z0-9' .-]{0,80})/);
  if (found?.[1]) {
    const work = found[1]
      .replace(/\b(ate|hoje|ontem|amanha|reais|real|pix|dinheiro|cartao)\b.*$/, "")
      .replace(/\br\$\s*[\d.,]+.*$/, "")
      .replace(/\b\d[\d.,]*\s*reais?\b.*$/, "")
      .trim();
    if (work) return titleName(work);
  }
  if (/\bmaterial\b/.test(normalized)) return "Material";
  return null;
}

const COURIER_PATTERNS = [
  `\\b(?:entregador|motoboy|moto boy)\\s+(?:e\\s+(?:o|a)\\s+|(?:o|a)\\s+)?(${HEARD_NAME})`,
  `\\bquem\\s+(?:e\\s+que\\s+)?(?:vai|fara|ira|faz|faria)(?:\\s+(?:fazer\\s+)?(?:a\\s+|o\\s+)?(?:entrega|coleta|entregar|coletar))?\\s+e\\s+(?:(?:o|a)\\s+)?(${HEARD_NAME})`,
  `\\b(?:o|a)\\s+(${HEARD_NAME})\\s+e\\s+quem\\s+(?:vai|fara|ira|faz|faria)\\b`,
  `\\b(?:o|a)\\s+(${HEARD_NAME})\\s+(?:vai|fara|ira|faz|faria)\\s+(?:fazer\\s+)?(?:a\\s+|o\\s+)?(?:entrega|coleta|entregar|coletar)\\b`,
  `\\b(?:a|o)\\s+(?:entrega|coleta)\\s+e\\s+(?:o|a|do|da)\\s+(?!(?:${PERSON_TITLE_PATTERN}))(${HEARD_NAME})`,
];

/** O entregador sai pelo papel na frase. O trecho sai do texto para não virar cliente. */
function takeCourier(normalized: string): { name: string | null; rest: string } {
  for (const source of COURIER_PATTERNS) {
    const found = normalized.match(new RegExp(source));
    if (!found || found.index == null) continue;
    const name = trimHeardName(found[1] ?? "");
    if (!name) continue;
    const rest = `${normalized.slice(0, found.index)} ${normalized.slice(found.index + found[0].length)}`;
    return { name, rest };
  }
  return { name: null, rest: normalized };
}

function taskType(normalized: string): "COLETA" | "ENTREGA" | null {
  if (/\bcolet(?:a|ar|ando|ou)\b/.test(normalized)) return "COLETA";
  if (/\bentreg(?:a|ar|ando|ou)\b/.test(normalized)) return "ENTREGA";
  return null;
}

/** Uma frase vira uma ordem. Sem "coleta" ou "entrega", a frase é ignorada. */
export function interpretLogisticsClause(
  clause: string,
  now: Date,
): LogisticsTaskDraft | null {
  const normalized = normalizePtExpression(clause);
  const type = taskType(normalized);
  if (!type) return null;

  let rest = normalized;
  let endExpression: string | null = null;
  let startExpression: string | null = null;

  const window = rest.match(/\b(?:das|entre)\s+(.+?)\s+(?:as|ate|e)\s+(.+?)(?=\s+\b(?:no|na|em|hoje|ontem|amanha)\b|$)/);
  if (window) {
    startExpression = window[1]?.trim() ?? null;
    endExpression = window[2]?.trim() ?? null;
    rest = rest.replace(window[0], " ");
  } else {
    const clockCut = "(?=,|\\s+\\b(?:entregador|motoboy|moto boy)\\b|\\s+\\b(?:para|pro|pra|no|na|em|ao)\\b|$)";
    const until = rest.match(new RegExp(`\\bate\\s+(?:as\\s+|a\\s+)?(.+?)${clockCut}`));
    const clock = until ?? rest.match(new RegExp(`\\bas\\s+(.+?)${clockCut}`));
    if (clock?.[1]) {
      endExpression = clock[1].trim();
      rest = rest.replace(clock[0], " ");
    }
  }

  const dateExpression = pickDateExpression(normalized);
  const courier = takeCourier(normalized);
  const clientName = pickClient(courier.rest);
  const workDescription = pickWork(normalized);
  const money = hearLogisticsMoney(clause);

  return {
    type,
    clientName,
    courierName: courier.name,
    workDescription,
    targetDate: resolveLogisticsDate(dateExpression, now),
    timeWindowStart: resolveLogisticsTime(startExpression),
    timeWindowEnd: resolveLogisticsTime(endExpression) ?? resolveLogisticsTime(normalized),
    amountCents: money.amountCents,
    paymentMethod: money.paymentMethod,
  };
}

/** Várias ordens no mesmo áudio, com data e hora relativas a `now`. */
function hasOrderContent(task: LogisticsTaskDraft): boolean {
  return Boolean(
    task.clientName ||
      task.courierName ||
      task.workDescription ||
      task.targetDate ||
      task.timeWindowStart ||
      task.timeWindowEnd ||
      task.amountCents != null,
  );
}

export function interpretLogisticsTranscript(transcript: string, now: Date): LogisticsTaskDraft[] {
  const tasks = splitLogisticsClauses(transcript)
    .map((clause) => interpretLogisticsClause(clause, now))
    .filter((task): task is LogisticsTaskDraft => task != null);
  const meaningful = tasks.filter(hasOrderContent);
  return meaningful.length > 0 ? meaningful : tasks;
}
