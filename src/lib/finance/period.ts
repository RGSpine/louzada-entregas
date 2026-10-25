/**
 * Resolução de períodos financeiros (dia, semana, mês, trimestre, semestre, ano)
 * no fuso do consultório (America/Sao_Paulo por padrão), com navegação
 * (período anterior/seguinte) e chaves estáveis para materialização idempotente.
 *
 * Toda a aritmética temporal vive aqui — nunca delegada à IA.
 */
import { DateTime } from "luxon";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export const FINANCE_PERIOD_PRESETS = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "SEMESTER",
  "YEAR",
] as const;

export type FinancePeriodPreset = (typeof FINANCE_PERIOD_PRESETS)[number];

export type ResolvedFinancePeriod = {
  preset: FinancePeriodPreset;
  timezone: string;
  /** Início inclusivo (UTC). */
  startUtc: Date;
  /** Fim EXCLUSIVO (UTC) — início do próximo período. Use `occurredAt < endUtc`. */
  endUtc: Date;
  /** Rótulo amigável em pt-BR. */
  label: string;
  /** Chave estável (ex.: "2026-06", "2026-W23", "2026-Q2", "2026-S1", "2026", "2026-06-07"). */
  periodKey: string;
  /** ISO yyyy-MM-dd da âncora usada (início do período, no fuso local). */
  anchorIso: string;
};

const MONTH_NAMES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function startOfPeriod(dt: DateTime, preset: FinancePeriodPreset): DateTime {
  switch (preset) {
    case "DAY":
      return dt.startOf("day");
    case "WEEK":
      // Luxon usa segunda-feira como início da semana ISO.
      return dt.startOf("week");
    case "MONTH":
      return dt.startOf("month");
    case "QUARTER":
      return dt.startOf("quarter");
    case "SEMESTER": {
      const semesterStartMonth = dt.month <= 6 ? 1 : 7;
      return dt.set({ month: semesterStartMonth }).startOf("month");
    }
    case "YEAR":
      return dt.startOf("year");
  }
}

function endOfPeriod(startDt: DateTime, preset: FinancePeriodPreset): DateTime {
  switch (preset) {
    case "DAY":
      return startDt.plus({ days: 1 });
    case "WEEK":
      return startDt.plus({ weeks: 1 });
    case "MONTH":
      return startDt.plus({ months: 1 });
    case "QUARTER":
      return startDt.plus({ months: 3 });
    case "SEMESTER":
      return startDt.plus({ months: 6 });
    case "YEAR":
      return startDt.plus({ years: 1 });
  }
}

function buildLabel(startDt: DateTime, preset: FinancePeriodPreset): string {
  const year = startDt.year;
  switch (preset) {
    case "DAY":
      return startDt.toFormat("dd/LL/yyyy");
    case "WEEK": {
      const end = startDt.plus({ days: 6 });
      return `Semana de ${startDt.toFormat("dd/LL")} a ${end.toFormat("dd/LL/yyyy")}`;
    }
    case "MONTH":
      return `${capitalize(MONTH_NAMES_PT[startDt.month - 1]!)} de ${year}`;
    case "QUARTER":
      return `${startDt.quarter}º trimestre de ${year}`;
    case "SEMESTER":
      return `${startDt.month <= 6 ? 1 : 2}º semestre de ${year}`;
    case "YEAR":
      return String(year);
  }
}

function buildPeriodKey(startDt: DateTime, preset: FinancePeriodPreset): string {
  switch (preset) {
    case "DAY":
      return startDt.toFormat("yyyy-LL-dd");
    case "WEEK":
      // ISO week-year + número da semana (estável p/ materialização semanal).
      return `${startDt.weekYear}-W${String(startDt.weekNumber).padStart(2, "0")}`;
    case "MONTH":
      return startDt.toFormat("yyyy-LL");
    case "QUARTER":
      return `${startDt.year}-Q${startDt.quarter}`;
    case "SEMESTER":
      return `${startDt.year}-S${startDt.month <= 6 ? 1 : 2}`;
    case "YEAR":
      return String(startDt.year);
  }
}

function nowInZone(tz: string): DateTime {
  return DateTime.now().setZone(tz);
}

/**
 * Resolve o período que contém `anchorDate` (ou agora), aplicando `offset` ciclos
 * (negativo = anterior, positivo = seguinte).
 */
export function resolveFinancePeriod(params: {
  preset: FinancePeriodPreset;
  anchorDate?: Date | null;
  /** yyyy-MM-dd no fuso local; alternativa a anchorDate. */
  anchorIso?: string | null;
  offset?: number;
  timezone?: string;
}): ResolvedFinancePeriod {
  const tz = params.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const offset = Number.isFinite(params.offset) ? (params.offset as number) : 0;

  let base: DateTime;
  if (params.anchorIso && /^\d{4}-\d{2}-\d{2}$/.test(params.anchorIso)) {
    base = DateTime.fromISO(params.anchorIso, { zone: tz });
  } else if (params.anchorDate) {
    base = DateTime.fromJSDate(params.anchorDate, { zone: "utc" }).setZone(tz);
  } else {
    base = nowInZone(tz);
  }
  if (!base.isValid) {
    base = nowInZone(tz);
  }

  let start = startOfPeriod(base, params.preset);

  if (offset !== 0) {
    // Avança/retrocede pelo tamanho do período e re-normaliza (cobre meses/semestres irregulares).
    const unitMap: Record<FinancePeriodPreset, Parameters<DateTime["plus"]>[0]> = {
      DAY: { days: offset },
      WEEK: { weeks: offset },
      MONTH: { months: offset },
      QUARTER: { months: 3 * offset },
      SEMESTER: { months: 6 * offset },
      YEAR: { years: offset },
    };
    start = startOfPeriod(start.plus(unitMap[params.preset]), params.preset);
  }

  const end = endOfPeriod(start, params.preset);

  return {
    preset: params.preset,
    timezone: tz,
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
    label: buildLabel(start, params.preset),
    periodKey: buildPeriodKey(start, params.preset),
    anchorIso: start.toFormat("yyyy-LL-dd"),
  };
}

/** Período imediatamente anterior ao informado (mesmo preset). */
export function previousFinancePeriod(period: ResolvedFinancePeriod): ResolvedFinancePeriod {
  return resolveFinancePeriod({
    preset: period.preset,
    anchorIso: period.anchorIso,
    offset: -1,
    timezone: period.timezone,
  });
}

/** Lançamento conta no período se `occurredAt` ∈ [startUtc, endUtc). */
export function occurredAtInPeriod(occurredAt: Date, period: ResolvedFinancePeriod): boolean {
  const t = occurredAt.getTime();
  return t >= period.startUtc.getTime() && t < period.endUtc.getTime();
}

export function isFinancePeriodPreset(value: unknown): value is FinancePeriodPreset {
  return (
    typeof value === "string" &&
    (FINANCE_PERIOD_PRESETS as readonly string[]).includes(value)
  );
}
