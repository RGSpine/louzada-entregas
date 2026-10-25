import { DateTime } from "luxon";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";
import { formatTimeOfDayMinutes, resolveTimeOnDay } from "@/lib/schedule-time-expression";

/** Marcação ativa candidata a remarcação/desmarcação. */
export type MatchableAppointment = {
  id: string;
  startAt: Date;
  endAt: Date;
};

export type DayWindow = { startUtc: Date; endUtc: Date };

export function formatSlotLabel(
  startAt: Date,
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): string {
  return DateTime.fromJSDate(startAt, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd/LL/yyyy 'às' HH:mm");
}

function withinWindow(startAt: Date, window: DayWindow): boolean {
  const t = startAt.getTime();
  return t >= window.startUtc.getTime() && t < window.endUtc.getTime();
}

/** Minutos desde a meia-noite no fuso do profissional. */
function localMinutesOfDay(startAt: Date, timezone: string): number {
  const dt = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(timezone);
  return dt.hour * 60 + dt.minute;
}

/**
 * Casa a hora dita contra os candidatos.
 *
 * Minuto exato primeiro. Se a expressão foi uma hora cheia ("14h"), aceita
 * qualquer marcação dentro daquela hora — quem diz "as 14h" costuma referir-se
 * ao slot das 14:30 também. Já "14:30" só casa 14:30.
 */
function matchByTimeOfDay(
  candidates: MatchableAppointment[],
  targetMinutes: number,
  timezone: string,
): MatchableAppointment[] {
  const exact = candidates.filter(
    (a) => localMinutesOfDay(a.startAt, timezone) === targetMinutes,
  );
  if (exact.length > 0) return exact;

  if (targetMinutes % 60 === 0) {
    const targetHour = targetMinutes / 60;
    return candidates.filter(
      (a) => Math.floor(localMinutesOfDay(a.startAt, timezone) / 60) === targetHour,
    );
  }

  return [];
}

/**
 * Escolhe a marcação existente visada por um comando de voz.
 *
 * Ordem: filtra pelo dia dito (quando dito) → sem dia, restringe ao futuro →
 * casa a hora dita (funciona com ou sem dia) → cai na única candidata → sem
 * pista nenhuma, usa a próxima marcação futura.
 *
 * Quando a hora dita não existe entre as candidatas, ou quando sobram várias
 * no mesmo dia sem hora, devolve erro listando os horários reais em vez de
 * adivinhar: remarcar e desmarcar são destrutivos.
 */
export function selectAppointmentForCommand(params: {
  patientName: string;
  appointments: MatchableAppointment[];
  dayWindow?: DayWindow | null;
  dayLabel?: string | null;
  /** Hora dita em minutos desde a meia-noite; desempata mesmo sem dia informado. */
  targetTimeOfDayMinutes?: number | null;
  now: Date;
  timezone?: string;
}): { ok: true; appointment: MatchableAppointment } | { ok: false; error: string } {
  const tz = params.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const { patientName, dayWindow, targetTimeOfDayMinutes, now } = params;
  // Rótulos vêm do parser temporal ("amanhã", "próxima segunda", "26/05/2026"),
  // por isso a frase usa "nessa data (...)" — encaixa em todos eles.
  const dayHint = params.dayLabel?.trim() ? ` (${params.dayLabel.trim()})` : "";

  const all = [...params.appointments].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  if (all.length === 0) {
    return {
      ok: false,
      error: `${patientName} não tem marcação ativa na agenda.`,
    };
  }

  if (dayWindow) {
    const sameDay = all.filter((a) => withinWindow(a.startAt, dayWindow));
    if (sameDay.length === 0) {
      return {
        ok: false,
        error: `${patientName} não tem marcação ativa nessa data${dayHint}. Confirme o dia.`,
      };
    }
    // Com o dia dito, marcação passada é alvo legítimo ("desmarque a Ana de segunda").
    return pickFromPool({ pool: sameDay, patientName, targetTimeOfDayMinutes, dayHint, tz });
  }

  // Sem dia dito, só marcações futuras entram — histórico não se mexe por acidente.
  const upcoming = all.filter((a) => a.startAt.getTime() >= now.getTime());
  if (upcoming.length === 0) {
    return {
      ok: false,
      error: `${patientName} só tem marcações passadas. Informe a data da marcação.`,
    };
  }

  return pickFromPool({ pool: upcoming, patientName, targetTimeOfDayMinutes, dayHint: "", tz });
}

function pickFromPool(params: {
  pool: MatchableAppointment[];
  patientName: string;
  targetTimeOfDayMinutes?: number | null;
  dayHint: string;
  tz: string;
}): { ok: true; appointment: MatchableAppointment } | { ok: false; error: string } {
  const { pool, patientName, targetTimeOfDayMinutes, dayHint, tz } = params;
  const times = () => pool.map((a) => formatSlotLabel(a.startAt, tz)).join(", ");

  if (typeof targetTimeOfDayMinutes === "number") {
    const matches = matchByTimeOfDay(pool, targetTimeOfDayMinutes, tz);
    if (matches.length > 0) {
      // Várias no mesmo horário em dias diferentes: a próxima é a visada.
      return { ok: true, appointment: matches[0]! };
    }
    return {
      ok: false,
      error: `${patientName} não tem marcação às ${formatTimeOfDayMinutes(targetTimeOfDayMinutes)}${dayHint}. Horários na agenda: ${times()}.`,
    };
  }

  if (pool.length === 1) {
    return { ok: true, appointment: pool[0]! };
  }

  if (dayHint) {
    return {
      ok: false,
      error: `${patientName} tem ${pool.length} marcações nessa data${dayHint}: ${times()}. Diga o horário para eu saber qual.`,
    };
  }

  return { ok: true, appointment: pool[0]! };
}

/**
 * Calcula o destino de uma remarcação preservando a duração original.
 * Sem nova data, mantém o dia; sem nova hora, mantém a hora local.
 */
export function resolveRescheduleTarget(params: {
  current: { startAt: Date; endAt: Date };
  newDayWindow?: DayWindow | null;
  newTimeExpression?: string | null;
  timezone?: string;
}): { ok: true; startUtc: Date; endUtc: Date; label: string } | { ok: false; error: string } {
  const tz = params.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
  const { current, newDayWindow, newTimeExpression } = params;
  const hasNewTime = Boolean(newTimeExpression?.trim());

  if (!newDayWindow && !hasNewTime) {
    return {
      ok: false,
      error: "Diga o novo dia ou o novo horário (ex.: remarque para sexta às 16h).",
    };
  }

  const currentLocal = DateTime.fromJSDate(current.startAt, { zone: "utc" }).setZone(tz);
  const durationMinutes = Math.max(
    15,
    Math.round((current.endAt.getTime() - current.startAt.getTime()) / 60_000),
  );

  const dayLocal = newDayWindow
    ? DateTime.fromJSDate(newDayWindow.startUtc, { zone: "utc" }).setZone(tz).startOf("day")
    : currentLocal.startOf("day");

  let startLocal: DateTime;
  if (hasNewTime) {
    const timeRes = resolveTimeOnDay(dayLocal, newTimeExpression);
    if (!timeRes.ok) {
      return { ok: false, error: timeRes.error };
    }
    startLocal = timeRes.at;
  } else {
    startLocal = dayLocal.set({
      hour: currentLocal.hour,
      minute: currentLocal.minute,
      second: 0,
      millisecond: 0,
    });
  }

  const startUtc = startLocal.toUTC().toJSDate();
  if (startUtc.getTime() === current.startAt.getTime()) {
    return {
      ok: false,
      error: `A marcação já está em ${formatSlotLabel(current.startAt, tz)}.`,
    };
  }

  const endUtc = startLocal.plus({ minutes: durationMinutes }).toUTC().toJSDate();

  return {
    ok: true,
    startUtc,
    endUtc,
    label: `${startLocal.toFormat("dd/LL/yyyy 'às' HH:mm")} (${durationMinutes} min)`,
  };
}
