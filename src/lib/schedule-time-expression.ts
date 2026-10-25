import { DateTime } from "luxon";

function normalizeTimeExpression(expr: string): string {
  return expr
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

/**
 * Interpreta hora falada/escrita (16h, às 16, 16:30). Sem fallback silencioso para 09:00.
 */
export function resolveTimeOnDay(
  dayStart: DateTime,
  timeExpression?: string | null,
): { ok: true; at: DateTime } | { ok: false; error: string } {
  if (!timeExpression?.trim()) {
    return { ok: false, error: "Horário não informado (ex.: 16h, 16:00, às 15)." };
  }

  let t = normalizeTimeExpression(timeExpression);
  t = t.replace(/horas?$/g, "").replace(/^as/, "");

  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) {
    const h = Math.min(23, parseInt(hm[1]!, 10));
    const m = Math.min(59, parseInt(hm[2]!, 10));
    return {
      ok: true,
      at: dayStart.set({ hour: h, minute: m, second: 0, millisecond: 0 }),
    };
  }

  const hmAlt = /^(\d{1,2})h(\d{2})$/.exec(t);
  if (hmAlt) {
    const h = Math.min(23, parseInt(hmAlt[1]!, 10));
    const m = Math.min(59, parseInt(hmAlt[2]!, 10));
    return {
      ok: true,
      at: dayStart.set({ hour: h, minute: m, second: 0, millisecond: 0 }),
    };
  }

  const hOnly = /^(\d{1,2})h?$/.exec(t);
  if (hOnly) {
    const h = Math.min(23, parseInt(hOnly[1]!, 10));
    return {
      ok: true,
      at: dayStart.set({ hour: h, minute: 0, second: 0, millisecond: 0 }),
    };
  }

  return {
    ok: false,
    error: `Horário não reconhecido: "${timeExpression.trim()}". Use ex.: 16h ou 16:00.`,
  };
}

/** Dia de referência fixo: só interessa a hora, não a data. */
const TIME_ONLY_REFERENCE_DAY = DateTime.fromObject(
  { year: 2000, month: 1, day: 1 },
  { zone: "utc" },
);

/**
 * Converte a hora dita em minutos desde a meia-noite ("16h" → 960), sem
 * vincular a um dia. Permite casar a hora contra marcações de dias diferentes.
 */
export function resolveTimeOfDayMinutes(
  timeExpression?: string | null,
): number | null {
  const res = resolveTimeOnDay(TIME_ONLY_REFERENCE_DAY, timeExpression);
  if (!res.ok) return null;
  return res.at.hour * 60 + res.at.minute;
}

export function formatTimeOfDayMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
