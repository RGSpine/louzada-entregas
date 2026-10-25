import { DateTime } from "luxon";

export const DEFAULT_SCHEDULE_TIMEZONE = "America/Sao_Paulo";

export type TemporalResolveOk = {
  ok: true;
  kind: "full_day";
  startUtc: Date;
  endUtc: Date;
  label: string;
};

export type TemporalResolveErr = {
  ok: false;
  code: "UNKNOWN" | "AMBIGUOUS" | "INVALID_TZ";
  message: string;
};

export type TemporalResolveResult = TemporalResolveOk | TemporalResolveErr;

/**
 * Remove acentos e normaliza espaços (matching de pt-BR falado/escrito).
 */
export function normalizePtExpression(raw: string): string {
  return raw
    .normalize("NFD")
    // Combining marks (equivalente a \p{M} sem flag `u`, compatível com target ES5 do tsc)
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2013\u2014-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
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

function startOfMondayWeek(dt: DateTime): DateTime {
  return dt.startOf("day").minus({ days: dt.weekday - 1 });
}

function okDay(start: DateTime, end: DateTime, label: string): TemporalResolveOk {
  return {
    ok: true,
    kind: "full_day",
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
    label,
  };
}

/**
 * Próximo dia da semana no sentido "próxima X": se hoje for X, retorna X da semana seguinte.
 */
export function nextWeekdayOccurrence(nowLux: DateTime, targetWeekday: number): DateTime {
  const today = nowLux.startOf("day");
  if (today.weekday === targetWeekday) {
    return today.plus({ weeks: 1 });
  }
  const daysUntil = (targetWeekday - today.weekday + 7) % 7;
  const forward = daysUntil === 0 ? 7 : daysUntil;
  return today.plus({ days: forward });
}

/**
 * "Essa/esta terça", "terça" (sem próxima): o weekday **ainda por vir** na linha do tempo
 * (hoje = esse weekday → hoje; domingo pedindo "essa terça" → terça desta semana civil à frente).
 */
export function essaWeekdayOccurrence(nowLux: DateTime, targetWeekday: number): DateTime {
  const today = nowLux.startOf("day");
  if (today.weekday === targetWeekday) {
    return today;
  }
  const daysUntil = (targetWeekday - today.weekday + 7) % 7;
  return today.plus({ days: daysUntil === 0 ? 7 : daysUntil });
}

const WEEKDAY_NAME_PATTERN =
  "(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?";

function resolveWeekdayByName(
  nowLux: DateTime,
  wdName: string,
  labelPrefix: string,
): TemporalResolveResult {
  const wd = WEEKDAY_TO_NUM[wdName];
  if (!wd) {
    return { ok: false, code: "UNKNOWN", message: "Dia da semana não reconhecido." };
  }
  const day = essaWeekdayOccurrence(nowLux, wd);
  return okDay(day.startOf("day"), day.endOf("day"), `${labelPrefix}${wdName}`);
}

/**
 * Semana civil **seguinte** à que contém `now`: segunda 00:00 → domingo fim do dia (America/Sao_Paulo ou `tz`).
 */
export function nextCalendarWeekRange(nowLux: DateTime): { start: DateTime; end: DateTime } {
  const thisMonday = startOfMondayWeek(nowLux);
  const nextMonday = thisMonday.plus({ weeks: 1 });
  const nextSunday = nextMonday.plus({ days: 6 }).endOf("day");
  return { start: nextMonday.startOf("day"), end: nextSunday };
}

/**
 * Resolve expressões curtas em pt-BR para um intervalo UTC [início do dia civil, fim do dia civil].
 *
 * Convenções:
 * - **semana que vem**: segunda da semana seguinte à atual até domingo 23:59:59.999 (semana começa segunda).
 * - **próxima segunda** (etc.): primeira ocorrência desse weekday **estritamente** no sentido do skill (hoje = esse weekday → +7 dias).
 * - **essa terça** / **esta quinta** / **nesta sexta**: weekday ainda por vir (hoje = esse dia → hoje; domingo + "essa terça" → terça iminente).
 * - **terça** (só o nome): mesmo que "essa terça" (não confundir com "próxima terça").
 * - **dia 30 de abril** / **30 de abril** / **26/05** / **26/05/2026**: ano corrente se a data local ainda não passou hoje; senão ano seguinte.
 */
export function resolveAppointmentWindow(
  expression: string,
  now: Date,
  tz: string = DEFAULT_SCHEDULE_TIMEZONE
): TemporalResolveResult {
  const nowLux = DateTime.fromJSDate(now, { zone: tz });
  if (!nowLux.isValid) {
    return { ok: false, code: "INVALID_TZ", message: `Timezone inválido: ${tz}` };
  }

  const n = normalizePtExpression(expression);

  if (!n) {
    return { ok: false, code: "UNKNOWN", message: "Expressão vazia." };
  }

  if (n === "hoje") {
    const s = nowLux.startOf("day");
    const e = nowLux.endOf("day");
    return okDay(s, e, "hoje");
  }

  if (n === "amanha") {
    const day = nowLux.plus({ days: 1 });
    return okDay(day.startOf("day"), day.endOf("day"), "amanhã");
  }

  if (n === "depois de amanha" || n === "depois de amanha") {
    const day = nowLux.plus({ days: 2 });
    return okDay(day.startOf("day"), day.endOf("day"), "depois de amanhã");
  }

  if (n === "semana que vem") {
    const { start, end } = nextCalendarWeekRange(nowLux);
    return okDay(start, end, "semana que vem");
  }

  const proxima = n.match(
    new RegExp(`^proxima\\s+${WEEKDAY_NAME_PATTERN}$`),
  );
  if (proxima) {
    const wd = WEEKDAY_TO_NUM[proxima[1]];
    const day = nextWeekdayOccurrence(nowLux, wd);
    return okDay(day.startOf("day"), day.endOf("day"), `próxima ${proxima[1]}`);
  }

  const essa = n.match(
    new RegExp(`^(essa|esta|nesta)\\s+${WEEKDAY_NAME_PATTERN}$`),
  );
  if (essa) {
    return resolveWeekdayByName(nowLux, essa[2], `${essa[1]} `);
  }

  const bareWeekday = n.match(new RegExp(`^${WEEKDAY_NAME_PATTERN}$`));
  if (bareWeekday) {
    return resolveWeekdayByName(nowLux, bareWeekday[1], "");
  }

  // "terça 18/08" / "terca-feira 18/08/2026" — a data explícita manda.
  const weekdaySlash = n.match(
    new RegExp(`^${WEEKDAY_NAME_PATTERN}\\s+(\\d{1,2}/\\d{1,2}(?:/\\d{4})?)$`),
  );
  if (weekdaySlash) {
    return resolveAppointmentWindow(weekdaySlash[2], now, tz);
  }

  const slashDate = n.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slashDate) {
    const dNum = parseInt(slashDate[1], 10);
    const month = parseInt(slashDate[2], 10);
    const yearExplicit = slashDate[3] ? parseInt(slashDate[3], 10) : undefined;
    if (month < 1 || month > 12 || dNum < 1 || dNum > 31) {
      return { ok: false, code: "UNKNOWN", message: "Data não reconhecida." };
    }
    let year = yearExplicit ?? nowLux.year;
    let candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
    if (!candidate.isValid) {
      return { ok: false, code: "UNKNOWN", message: "Data inválida no calendário." };
    }
    if (!yearExplicit) {
      const todayStart = nowLux.startOf("day");
      if (candidate.startOf("day") < todayStart) {
        year += 1;
        candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
        if (!candidate.isValid) {
          return { ok: false, code: "UNKNOWN", message: "Data inválida no ano seguinte." };
        }
      }
    }
    return okDay(
      candidate.startOf("day"),
      candidate.endOf("day"),
      `${String(dNum).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    );
  }

  const dayOnly = n.match(/^dia\s+(\d{1,2})$/);
  if (dayOnly) {
    const dNum = parseInt(dayOnly[1], 10);
    const month = nowLux.month;
    let year = nowLux.year;
    let candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
    if (!candidate.isValid) {
      return { ok: false, code: "UNKNOWN", message: "Data inválida no calendário." };
    }
    const todayStart = nowLux.startOf("day");
    if (candidate.startOf("day") < todayStart) {
      const nextMonth = nowLux.plus({ months: 1 });
      year = nextMonth.year;
      const m = nextMonth.month;
      candidate = DateTime.fromObject({ year, month: m, day: dNum }, { zone: tz });
      if (!candidate.isValid) {
        return { ok: false, code: "UNKNOWN", message: "Data inválida no mês seguinte." };
      }
    }
    return okDay(
      candidate.startOf("day"),
      candidate.endOf("day"),
      `dia ${dNum}/${candidate.month}/${candidate.year}`,
    );
  }

  const monthDayYear = n.match(
    /^(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/
  );
  if (monthDayYear) {
    const dNum = parseInt(monthDayYear[1], 10);
    const monthName = monthDayYear[2];
    const yearExplicit = monthDayYear[3] ? parseInt(monthDayYear[3], 10) : undefined;
    const month = MONTHS[monthName];
    if (!month || dNum < 1 || dNum > 31) {
      return { ok: false, code: "UNKNOWN", message: "Data não reconhecida." };
    }
    let year = yearExplicit ?? nowLux.year;
    let candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
    if (!candidate.isValid) {
      return { ok: false, code: "UNKNOWN", message: "Data inválida no calendário." };
    }
    if (!yearExplicit) {
      const todayStart = nowLux.startOf("day");
      if (candidate.startOf("day") < todayStart) {
        year += 1;
        candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
        if (!candidate.isValid) {
          return { ok: false, code: "UNKNOWN", message: "Data inválida no ano seguinte." };
        }
      }
    }
    return okDay(candidate.startOf("day"), candidate.endOf("day"), `${dNum}/${month}/${year}`);
  }

  const weekdayDayMonth = n.match(
    /^(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\s+dia\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/
  );
  if (weekdayDayMonth) {
    const wdName = weekdayDayMonth[1];
    const dNum = parseInt(weekdayDayMonth[2], 10);
    const monthName = weekdayDayMonth[3];
    const yearExplicit = weekdayDayMonth[4] ? parseInt(weekdayDayMonth[4], 10) : undefined;
    const expectedWd = WEEKDAY_TO_NUM[wdName];
    const month = MONTHS[monthName];
    if (!month || dNum < 1 || dNum > 31) {
      return { ok: false, code: "UNKNOWN", message: "Data não reconhecida." };
    }
    let year = yearExplicit ?? nowLux.year;
    let candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
    if (!candidate.isValid) {
      return { ok: false, code: "UNKNOWN", message: "Data inválida no calendário." };
    }
    if (candidate.weekday !== expectedWd) {
      return {
        ok: false,
        code: "AMBIGUOUS",
        message: `O dia ${dNum} de ${monthName} de ${year} não é ${wdName.replace("-feira", "")}.`,
      };
    }
    if (!yearExplicit) {
      const todayStart = nowLux.startOf("day");
      if (candidate.startOf("day") < todayStart) {
        year += 1;
        candidate = DateTime.fromObject({ year, month, day: dNum }, { zone: tz });
        if (!candidate.isValid || candidate.weekday !== expectedWd) {
          return {
            ok: false,
            code: "AMBIGUOUS",
            message: "Não foi possível resolver o ano sem ambiguidade.",
          };
        }
      }
    }
    return okDay(candidate.startOf("day"), candidate.endOf("day"), `${wdName} ${dNum}/${month}/${year}`);
  }

  if (/\bas\s+\d{1,2}\b/.test(n) && !/(amanha|hoje|semana|proxima|essa|esta|nesta|de\s+janeiro)/.test(n)) {
    return {
      ok: false,
      code: "AMBIGUOUS",
      message: "Horário sem dia associado — use também uma data ou expressão como 'amanhã'.",
    };
  }

  return {
    ok: false,
    code: "UNKNOWN",
    message: "Expressão temporal não suportada nesta versão.",
  };
}

/** Teto por expressão composta (ex.: "próximas 8 segundas"). */
export const MAX_SCHEDULE_MULTI_DAY = 16;

const PT_COUNT_WORDS: Record<string, number> = {
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
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
};

const PT_COUNT_ALT = Object.keys(PT_COUNT_WORDS).join("|");

function parseOccurrenceCount(raw: string): number | null {
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n >= 1 && n <= MAX_SCHEDULE_MULTI_DAY ? n : null;
  }
  return PT_COUNT_WORDS[raw] ?? null;
}

/**
 * Remove horário colado na expressão de data ("terça e quinta às 19:30" → "terça e quinta").
 * O horário continua a vir de `timeExpression` no item da intenção.
 *
 * Formatos cobertos (com ou sem "às/as/à"):
 * - 14 / 14h / 14h30 / 14:30 / 14 h30 / 14hs
 */
const TRAILING_TIME_WITH_AS =
  /\s+(?:as|a)\s+\d{1,2}(?:\s*[h:]\s*\d{1,2}|\s*h(?:oras?)?)?\s*$/i;
const TRAILING_TIME_BARE = /\s+\d{1,2}(?:\s*[h:]\s*\d{2}|\s*h(?:oras?)?)\s*$/i;

export function stripTrailingTimeFromDateExpression(expression: string): string {
  return normalizePtExpression(expression)
    .replace(TRAILING_TIME_WITH_AS, "")
    .replace(TRAILING_TIME_BARE, "")
    .trim();
}

function formatSlashDate(day: DateTime): string {
  return day.toFormat("dd/LL/yyyy");
}

/**
 * "próximas 8 segundas" / "as próximas oito terças-feiras" → N datas dd/MM/yyyy.
 * Usa a semântica de "próxima X" na 1.ª ocorrência e +7 dias nas seguintes.
 */
function expandRepeatedWeekday(
  normalized: string,
  nowLux: DateTime,
): string[] | null {
  const m = normalized.match(
    new RegExp(
      `^(?:(?:as?|nas?)\\s+)?proximas?\\s+(${PT_COUNT_ALT}|\\d{1,2})\\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)s?(?:\\s*feiras?)?$`,
    ),
  );
  if (!m) return null;
  const count = parseOccurrenceCount(m[1]);
  const wd = WEEKDAY_TO_NUM[m[2]];
  if (!count || !wd) return null;

  let cursor = nextWeekdayOccurrence(nowLux, wd);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatSlashDate(cursor));
    cursor = cursor.plus({ weeks: 1 });
  }
  return out;
}

type MultiDayPart = {
  prefix: "essa" | "esta" | "nesta" | "proxima" | null;
  weekday: number | null;
  /** Data explícita dd/MM[/yyyy] quando dita (ex.: terça, 18/08). */
  slashDate: string | null;
};

const SLASH_DATE_PATTERN = "(\\d{1,2}/\\d{1,2}(?:/\\d{4})?)";

/**
 * Resolve slash date (com ano implícito se omitido) para dia civil no tz.
 */
function resolveSlashDatePart(
  slash: string,
  nowLux: DateTime,
  tz: string,
): DateTime | null {
  const window = resolveAppointmentWindow(slash, nowLux.toJSDate(), tz);
  if (!window.ok) return null;
  return DateTime.fromJSDate(window.startUtc, { zone: "utc" }).setZone(tz).startOf("day");
}

/**
 * "terca, 18/08" vira um token após split por vírgula — reanexa a data ao weekday.
 */
function coalesceWeekdayDateParts(parts: string[]): string[] {
  const out: string[] = [];
  const bareWd = new RegExp(`^(?:(essa|esta|nesta|proxima)\\s+)?${WEEKDAY_NAME_PATTERN}$`);
  const onlySlash = new RegExp(`^${SLASH_DATE_PATTERN}$`);
  for (const part of parts) {
    if (onlySlash.test(part) && out.length > 0 && bareWd.test(out[out.length - 1]!)) {
      out[out.length - 1] = `${out[out.length - 1]} ${part}`;
      continue;
    }
    out.push(part);
  }
  return out;
}

/**
 * Lista "terça e quinta" / "terça, 18/08, e quinta, 20/08" / "18/08 e 20/08".
 * Weekdays sem data explícita caem na **mesma semana civil** (seg–dom) da
 * âncora = max das ocorrências individuais — evita "terça=18 e quinta=amanhã"
 * quando hoje é quarta.
 */
function expandWeekdayOrDateList(
  normalized: string,
  nowLux: DateTime,
  tz: string,
): string[] | null {
  if (!/(?:,|\be\b)/.test(normalized)) return null;

  // `, e ` deve consumir o "e" (senão sobra "e quinta" e o weekday falha).
  const parts = coalesceWeekdayDateParts(
    normalized
      .split(/\s*,\s*(?:e\s+)?|\s+e\s+/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
  if (parts.length < 2) return null;

  const parsed: MultiDayPart[] = [];
  for (const part of parts) {
    // "terca feira 18/08" | "essa terca, 18/08" | "terca"
    const wdDate = part.match(
      new RegExp(
        `^(?:(essa|esta|nesta|proxima)\\s+)?${WEEKDAY_NAME_PATTERN}(?:\\s+${SLASH_DATE_PATTERN})?$`,
      ),
    );
    if (wdDate) {
      parsed.push({
        prefix: (wdDate[1] as MultiDayPart["prefix"]) ?? null,
        weekday: WEEKDAY_TO_NUM[wdDate[2]] ?? null,
        slashDate: wdDate[3] ?? null,
      });
      continue;
    }
    // Só data: "18/08" | "18/08/2026"
    const onlyDate = part.match(new RegExp(`^${SLASH_DATE_PATTERN}$`));
    if (onlyDate) {
      parsed.push({ prefix: null, weekday: null, slashDate: onlyDate[1] });
      continue;
    }
    return null;
  }

  const resolved: DateTime[] = [];
  let hasBareWeekday = false;

  for (const p of parsed) {
    if (p.slashDate) {
      const day = resolveSlashDatePart(p.slashDate, nowLux, tz);
      if (!day) return null;
      if (p.weekday != null && day.weekday !== p.weekday) {
        // Data dita não bate com o weekday — usa a data (mais específica).
      }
      resolved.push(day);
      continue;
    }
    if (p.weekday == null) return null;
    hasBareWeekday = true;
    const day =
      p.prefix === "proxima"
        ? nextWeekdayOccurrence(nowLux, p.weekday)
        : essaWeekdayOccurrence(nowLux, p.weekday);
    resolved.push(day.startOf("day"));
  }

  // Alinha weekdays bare à semana da âncora (maior data individual).
  if (hasBareWeekday) {
    let anchor = resolved[0]!;
    for (const d of resolved) {
      if (d.toMillis() > anchor.toMillis()) anchor = d;
    }
    const weekMonday = startOfMondayWeek(anchor);
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]!;
      if (p.slashDate || p.weekday == null) continue;
      resolved[i] = weekMonday.plus({ days: p.weekday - 1 }).startOf("day");
    }
  }

  return resolved.map(formatSlashDate);
}

/**
 * Expande uma expressão de data composta em várias expressões simples
 * que `resolveAppointmentWindow` já entende.
 *
 * - Expressão simples → `[expressão]` (com horário colado removido, se houver)
 * - Lista de weekdays/datas → N datas `dd/MM/yyyy` (mesma semana civil)
 * - "próximas N weekdays" → N datas `dd/MM/yyyy`
 */
export function expandMultiDayDateExpressions(
  expression: string,
  now: Date,
  tz: string = DEFAULT_SCHEDULE_TIMEZONE,
): string[] {
  const raw = expression?.trim();
  if (!raw) return [];

  // Valida tz + instante de referência com o `now` fornecido (determinístico
  // para testes; não usar DateTime.now() aqui).
  const nowLux = DateTime.fromJSDate(now, { zone: tz });
  if (!nowLux.isValid) {
    return [raw];
  }

  const normalized = stripTrailingTimeFromDateExpression(raw);
  if (!normalized) return [raw];

  const repeated = expandRepeatedWeekday(normalized, nowLux);
  if (repeated && repeated.length > 0) {
    return repeated.slice(0, MAX_SCHEDULE_MULTI_DAY);
  }

  const list = expandWeekdayOrDateList(normalized, nowLux, tz);
  if (list && list.length > 1) {
    return list.slice(0, MAX_SCHEDULE_MULTI_DAY);
  }

  // Mantém a forma original quando não há expansão (labels amigáveis).
  // Se só removemos horário colado, devolve a versão limpa.
  if (normalized !== normalizePtExpression(raw)) {
    return [normalized];
  }
  return [raw];
}
