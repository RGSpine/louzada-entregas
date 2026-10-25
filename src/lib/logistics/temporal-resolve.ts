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
    "cinco horas da tarde = 17:00; seis da tarde = 18:00; meio-dia = 12:00; meia-noite = 00:00.",
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

/** Resolve "17:00", "17h", "cinco horas da tarde", "meio-dia". */
export function resolveLogisticsTime(expression: string | null | undefined): string | null {
  if (!expression?.trim()) return null;
  let n = normalizePtExpression(expression)
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\bhoras?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (n === "meio dia" || n === "meio-dia") return "12:00";
  if (n === "meia noite" || n === "meia-noite") return "00:00";

  const clock = n.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return padClock(Number(clock[1]), Number(clock[2]));

  const compact = n.match(/^(\d{1,2})\s*h\s*(\d{2})?$/);
  if (compact) return padClock(Number(compact[1]), compact[2] ? Number(compact[2]) : 0);

  const half = /\be meia\b/.test(n);
  n = n.replace(/\be meia\b/g, " ").replace(/\s+/g, " ").trim();
  const spoken = n.match(
    /^(?:as |a )?(\d{1,2}|uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?: (da manha|de manha|da tarde|da noite))?$/,
  );
  if (!spoken) return null;
  const rawHour = /^\d+$/.test(spoken[1] ?? "") ? Number(spoken[1]) : HOUR_WORDS[spoken[1] ?? ""];
  if (rawHour == null) return null;
  const minute = half ? 30 : 0;
  const period = spoken[2];
  let hour = rawHour;
  if (period === "da tarde" || period === "da noite") {
    if (hour < 12) hour += 12;
  } else if (period === "da manha" || period === "de manha") {
    if (hour === 12) hour = 0;
  }
  return padClock(hour, minute);
}
