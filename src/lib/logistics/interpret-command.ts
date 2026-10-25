import { normalizePtExpression } from "@/lib/schedule-temporal-parse";

import type { LogisticsTaskDraft } from "@/lib/logistics/intake-schema";
import { hearLogisticsMoney } from "@/lib/logistics/money";
import { resolveLogisticsDate, resolveLogisticsTime } from "@/lib/logistics/temporal-resolve";

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
    const marks = [...chunk.matchAll(/\b(colet(?:a|ar|ando|ou)|entreg(?:a|ar|ando|ou))\b/gi)];
    if (marks.length <= 1) {
      clauses.push(chunk);
      continue;
    }
    let cursor = 0;
    for (let i = 1; i < marks.length; i += 1) {
      const at = marks[i]?.index ?? chunk.length;
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

function pickClient(normalized: string): string | null {
  const found = normalized.match(
    /\b(?:no|na|em|do|da|pro|pra)\s+(?:dr\.?\s*|doutora?\s+)?([a-z0-9][a-z0-9' .-]{0,80})/,
  );
  if (!found?.[1]) return null;
  const name = found[1]
    .split(",")[0]
    .split(/\s+\ba\s+|\s+\bo\s+/)[0]
    .replace(/\b(ate|hoje|ontem|amanha|semana|servico|paciente|reais|real|pix|dinheiro|cartao|transferencia|pago|pagou|valor)\b.*$/, "")
    .replace(/\br\$\s*[\d.,]+.*$/, "")
    .replace(/\b\d[\d.,]*\b.*$/, "")
    .replace(/[^a-z0-9' .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || /^(dr|doutor|doutora|pix|dinheiro|cartao)$/.test(name)) return null;
  return titleName(name);
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

function pickCourier(normalized: string): string | null {
  const found = normalized.match(/\b(?:entregador|motoboy|moto boy)\s+([a-z][a-z']{1,40})/);
  if (!found?.[1]) return null;
  const blocked = new Set(["ira", "vai", "para", "pra", "coletar", "coleta", "entregar", "entrega"]);
  if (blocked.has(found[1])) return null;
  return titleName(found[1]);
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
    const until = rest.match(/\bate\s+(?:as\s+|a\s+)?(.+?)$/);
    const clock = until ?? rest.match(/\bas\s+(.+?)$/);
    if (clock?.[1]) {
      endExpression = clock[1].trim();
      rest = rest.replace(clock[0], " ");
    }
  }

  const dateExpression = pickDateExpression(normalized);
  const clientName = pickClient(rest);
  const workDescription = pickWork(normalized);
  const money = hearLogisticsMoney(clause);

  return {
    type,
    clientName,
    courierName: pickCourier(normalized),
    workDescription,
    targetDate: resolveLogisticsDate(dateExpression, now),
    timeWindowStart: resolveLogisticsTime(startExpression),
    timeWindowEnd: resolveLogisticsTime(endExpression),
    amountCents: money.amountCents,
    paymentMethod: money.paymentMethod,
  };
}

/** Várias ordens no mesmo áudio, com data e hora relativas a `now`. */
export function interpretLogisticsTranscript(transcript: string, now: Date): LogisticsTaskDraft[] {
  return splitLogisticsClauses(transcript)
    .map((clause) => interpretLogisticsClause(clause, now))
    .filter((task): task is LogisticsTaskDraft => task != null);
}
