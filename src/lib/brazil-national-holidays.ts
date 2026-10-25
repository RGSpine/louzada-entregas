import { DateTime } from "luxon";

/** Nome oficial (uso em UI / logs; não substituir calendário legal). */
export type BrazilNationalHoliday = {
  /** Data civil em `tz` (início do dia). */
  date: string;
  name: string;
};

/**
 * Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
 */
export function getEasterSundayGregorian(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function fixedHoliday(year: number, month: number, day: number, name: string, tz: string): BrazilNationalHoliday {
  const dt = DateTime.fromObject({ year, month, day }, { zone: tz }).startOf("day");
  return { date: dt.toISODate()!, name };
}

/**
 * Feriados nacionais fixos + móveis (Carnaval terça, Sexta-feira Santa, Corpus Christi)
 * conforme prática federal usual (Corpus = 60 dias após o domingo de Páscoa).
 */
export function listBrazilNationalHolidays(year: number, tz = "America/Sao_Paulo"): BrazilNationalHoliday[] {
  const e = getEasterSundayGregorian(year);
  const easter = DateTime.fromObject({ year, month: e.month, day: e.day }, { zone: tz }).startOf("day");
  const carnivalTuesday = easter.minus({ days: 47 });
  const goodFriday = easter.minus({ days: 2 });
  const corpusChristi = easter.plus({ days: 60 });

  const fixed: BrazilNationalHoliday[] = [
    fixedHoliday(year, 1, 1, "Confraternização Universal", tz),
    fixedHoliday(year, 4, 21, "Tiradentes", tz),
    fixedHoliday(year, 5, 1, "Dia do Trabalhador", tz),
    fixedHoliday(year, 9, 7, "Independência do Brasil", tz),
    fixedHoliday(year, 10, 12, "Nossa Senhora Aparecida", tz),
    fixedHoliday(year, 11, 2, "Finados", tz),
    fixedHoliday(year, 11, 15, "Proclamação da República", tz),
    fixedHoliday(year, 12, 25, "Natal", tz),
  ];

  const movable: BrazilNationalHoliday[] = [
    { date: carnivalTuesday.toISODate()!, name: "Carnaval (terça-feira)" },
    { date: goodFriday.toISODate()!, name: "Sexta-feira Santa" },
    { date: corpusChristi.toISODate()!, name: "Corpus Christi" },
  ];

  const all = [...fixed, ...movable];
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all;
}

export function getBrazilNationalHolidayName(isoDate: string, year: number, tz = "America/Sao_Paulo"): string | null {
  const list = listBrazilNationalHolidays(year, tz);
  const hit = list.find((h) => h.date === isoDate);
  return hit?.name ?? null;
}

export function isBrazilNationalHoliday(isoDate: string, tz = "America/Sao_Paulo"): boolean {
  const y = DateTime.fromISO(isoDate, { zone: tz }).year;
  return listBrazilNationalHolidays(y, tz).some((h) => h.date === isoDate);
}
