import { DateTime } from "luxon";

import {
  DEFAULT_SCHEDULE_TIMEZONE,
  nextCalendarWeekRange,
  normalizePtExpression,
  resolveAppointmentWindow,
} from "@/lib/schedule-temporal-parse";

const HOUR_WORDS: Record<string, number> = {
  uma: 1,
  um: 1,
  duas: 2,
  dois: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

const WEEKDAY_TO_NUM: Record<string, number> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  domingo: 7,
};

export type TemporalAnchor = {
  timeZone: string;
  isoDate: string;
  time: string;
  weekday: string;
  hoje: string;
  ontem: string;
  amanha: string;
  depoisDeAmanha: string;
  semanaQueVem: string;
};

const WEEKDAY_PT = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

function padClock(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function ymd(dt: DateTime): string {
  return dt.toFormat("yyyy-LL-dd");
}

/** Calendário do instante em que o comando foi dito. A LLM e o parser usam estes marcos. */
export function temporalAnchor(now: Date, tz: string = DEFAULT_SCHEDULE_TIMEZONE): TemporalAnchor {
  const local = DateTime.fromJSDate(now, { zone: tz });
  const week = nextCalendarWeekRange(local);
  return {
    timeZone: tz,
    isoDate: ymd(local),
    time: local.toFormat("HH:mm"),
    weekday: WEEKDAY_PT[local.weekday - 1] ?? "",
    hoje: ymd(local),
    ontem: ymd(local.minus({ days: 1 })),
    amanha: ymd(local.plus({ days: 1 })),
    depoisDeAmanha: ymd(local.plus({ days: 2 })),
    semanaQueVem: ymd(week.start),
  };
}

export function formatTemporalAnchor(anchor: TemporalAnchor): string {
  return [
    `Agora: ${anchor.weekday}, ${anchor.isoDate} ${anchor.time} (${anchor.timeZone}).`,
    `hoje = ${anchor.hoje}`,
    `ontem = ${anchor.ontem}`,
    `amanhã = ${anchor.amanha}`,
    `depois de amanhã = ${anchor.depoisDeAmanha}`,
    `semana que vem começa na segunda ${anchor.semanaQueVem}`,
    "cinco horas da tarde = 17:00; dezessete horas = 17:00; seis da tarde = 18:00; meio-dia = 12:00; meia-noite = 00:00.",
    "coleta/coletar = COLETA. entrega/entregar = ENTREGA. O horário limite fica em timeWindowEnd.",
  ].join("\n");
}

/** Resolve "hoje", "amanhã", "semana que vem", "próxima terça" para YYYY-MM-DD. */
export function resolveLogisticsDate(
  expression: string | null | undefined,
  now: Date,
  tz: string = DEFAULT_SCHEDULE_TIMEZONE,
): string | null {
  if (!expression?.trim()) return null;
  const n = normalizePtExpression(expression);
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;

  const local = DateTime.fromJSDate(now, { zone: tz });
  if (!local.isValid) return null;
  if (n === "ontem") return ymd(local.minus({ days: 1 }));
  if (n === "semana passada") {
    const thisMonday = local.startOf("day").minus({ days: local.weekday - 1 });
    return ymd(thisMonday.minus({ weeks: 1 }));
  }

  const nextWeekDay = n.match(
    /^semana que vem(?:\s+(?:na|nesta))?\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?$/,
  );
  if (nextWeekDay) {
    const weekday = WEEKDAY_TO_NUM[nextWeekDay[1] ?? ""];
    if (!weekday) return null;
    const monday = nextCalendarWeekRange(local).start;
    return ymd(monday.plus({ days: weekday - 1 }));
  }

  const resolved = resolveAppointmentWindow(n, now, tz);
  if (!resolved.ok) return null;
  return DateTime.fromJSDate(resolved.startUtc, { zone: "utc" }).setZone(tz).toFormat("yyyy-LL-dd");
}

const SPOKEN_HOUR =
  "vinte e uma|vinte e um|vinte e duas|vinte e dois|vinte e tres|vinte|dezenove|dezessete|dezoito|dezesseis|quatorze|catorze|quinze|treze|onze|doze|uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez";

function hourFromSpoken(token: string): number | null {
  if (token === "vinte") return 20;
  if (token === "vinte e uma" || token === "vinte e um") return 21;
  if (token === "vinte e duas" || token === "vinte e dois") return 22;
  if (token === "vinte e tres") return 23;
  if (/^\d+$/.test(token)) return Number(token);
  return HOUR_WORDS[token] ?? null;
}

function clockFromHour(rawHour: number, minute: number, period?: string): string | null {
  let hour = rawHour;
  if (period === "da tarde" || period === "da noite") {
    if (hour < 12) hour += 12;
  } else if (period === "da manha" || period === "de manha") {
    if (hour === 12) hour = 0;
  }
  return padClock(hour, minute);
}

/**
 * Resolve "17:00", "17h", "cinco horas da tarde", "dezessete horas".
 * O horário pode vir no meio da frase ("às dezessete horas, entregador Paulo").
 */
export function resolveLogisticsTime(expression: string | null | undefined): string | null {
  if (!expression?.trim()) return null;
  const n = normalizePtExpression(expression).replace(/[.,;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\bmeio[- ]dia\b/.test(n)) return "12:00";
  if (/\bmeia[- ]noite\b/.test(n)) return "00:00";

  const numericClock = firstNumericClock(n);
  if (numericClock) return numericClock;

  const spoken = n.match(
    new RegExp(`\\b(${SPOKEN_HOUR})(?:\\s+horas?)?(?:\\s+e\\s+meia)?(?:\\s+(da manha|de manha|da tarde|da noite))?\\b`),
  );
  if (!spoken) return null;
  const rawHour = hourFromSpoken(spoken[1] ?? "");
  if (rawHour == null) return null;
  const mentioned =
    /\bhoras?\b|\bda tarde\b|\bda noite\b|\bda manha\b|\bde manha\b|\bas\b|\bate\b|\bh\b|\be meia\b/.test(n);
  if (!mentioned && n !== spoken[1]) return null;
  const minute = /\be meia\b/.test(spoken[0] ?? "") ? 30 : 0;
  return clockFromHour(rawHour, minute, spoken[2]);
}

function firstNumericClock(n: string): string | null {
  const re = /\b(\d{1,2})(?::(\d{2}))?(?:\s*h(?:\s*(\d{2}))?)?\b/g;
  for (const match of n.matchAll(re)) {
    const ownClock = match[2] != null || match[3] != null || /h/i.test(match[0]);
    const window = n.slice(Math.max(0, (match.index ?? 0) - 6), (match.index ?? 0) + match[0].length + 16);
    const nearMarker = /\b(?:as|ate|horas?|da tarde|da noite|da manha|de manha)\b/.test(window);
    if (!ownClock && !nearMarker && n !== match[1]) continue;
    const minute = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : 0;
    const period = window.match(/\b(da tarde|da noite|da manha|de manha)\b/)?.[1];
    const clock = clockFromHour(Number(match[1]), minute, period);
    if (clock) return clock;
  }
  return null;
}
