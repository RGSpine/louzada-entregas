/**
 * Balanço de colaboradores (Consultório/Clínica).
 *
 * Isolamento: sempre filtra por professionalUserId (= tenant).
 * Comissão: IntraUser.commissionRateBps (por perfil, livre pelo ADMIN).
 * Base: PatientServiceSession.allocatedPriceCents das sessões consumidas no
 * período cujo atendente é o Intra User (evolução.attendingIntraUserId ou
 * appointment.intraUserId).
 * Devido = floor(base * bps / 10000). Pago = sum(CollaboratorPayout.amountCents).
 * Saldo = max(0, devido − pago). A IA nunca faz esta conta.
 */
import { DateTime } from "luxon";
import { CollaboratorPayoutPeriod } from "@prisma/client";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export const COLLABORATOR_PAYOUT_PRESETS = [
  "WEEK",
  "FORTNIGHT",
  "MONTH",
] as const satisfies ReadonlyArray<CollaboratorPayoutPeriod>;

export type CollaboratorPayoutPreset = (typeof COLLABORATOR_PAYOUT_PRESETS)[number];

export type ResolvedCollaboratorPeriod = {
  preset: CollaboratorPayoutPreset;
  timezone: string;
  startUtc: Date;
  /** Fim exclusivo. */
  endUtc: Date;
  label: string;
  periodKey: string;
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

/** Comissão em centavos a partir da base e basis points (0–10000). */
export function commissionCentsFromBase(baseCents: number, rateBps: number): number {
  const base = Math.max(0, Math.trunc(baseCents));
  const bps = Math.min(10_000, Math.max(0, Math.trunc(rateBps)));
  return Math.floor((base * bps) / 10_000);
}

/** Percentual amigável a partir de bps (ex.: 1500 → "15"; 1250 → "12,5"). */
export function bpsToPercentDisplay(bps: number): string {
  const n = Math.min(10_000, Math.max(0, Math.trunc(bps))) / 100;
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(2)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

/** Parse "15" ou "15,5" → bps; null se inválido. */
export function percentInputToBps(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  return Math.round(num * 100);
}

export function resolveCollaboratorPeriod(params: {
  preset: CollaboratorPayoutPreset;
  anchorIso?: string | null;
  offset?: number;
  timezone?: string;
}): ResolvedCollaboratorPeriod {
  const tz = params.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;
  const offset = Number.isFinite(params.offset) ? (params.offset as number) : 0;

  let base: DateTime;
  if (params.anchorIso && /^\d{4}-\d{2}-\d{2}$/.test(params.anchorIso)) {
    base = DateTime.fromISO(params.anchorIso, { zone: tz });
  } else {
    base = DateTime.now().setZone(tz);
  }
  if (!base.isValid) base = DateTime.now().setZone(tz);

  if (params.preset === "WEEK") {
    let start = base.startOf("week");
    if (offset !== 0) start = start.plus({ weeks: offset }).startOf("week");
    const end = start.plus({ weeks: 1 });
    return {
      preset: "WEEK",
      timezone: tz,
      startUtc: start.toUTC().toJSDate(),
      endUtc: end.toUTC().toJSDate(),
      label: `Semana de ${start.toFormat("dd/LL")} a ${end.minus({ days: 1 }).toFormat("dd/LL/yyyy")}`,
      periodKey: `rec-W:${start.weekYear}-W${String(start.weekNumber).padStart(2, "0")}`,
      anchorIso: start.toFormat("yyyy-LL-dd"),
    };
  }

  if (params.preset === "MONTH") {
    let start = base.startOf("month");
    if (offset !== 0) start = start.plus({ months: offset }).startOf("month");
    const end = start.plus({ months: 1 });
    return {
      preset: "MONTH",
      timezone: tz,
      startUtc: start.toUTC().toJSDate(),
      endUtc: end.toUTC().toJSDate(),
      label: `${capitalize(MONTH_NAMES_PT[start.month - 1]!)} de ${start.year}`,
      periodKey: `rec-M:${start.toFormat("yyyy-LL")}`,
      anchorIso: start.toFormat("yyyy-LL-dd"),
    };
  }

  // FORTNIGHT: 1–15 = H1; 16–fim = H2
  let cursor = base.startOf("day");
  if (offset !== 0) {
    // Avança/retrocede quinzenas: H1↔H2 no mesmo mês, depois mês vizinho.
    let half = cursor.day <= 15 ? 0 : 1;
    let monthStart = cursor.startOf("month");
    let steps = offset;
    while (steps !== 0) {
      if (steps > 0) {
        if (half === 0) half = 1;
        else {
          monthStart = monthStart.plus({ months: 1 });
          half = 0;
        }
        steps -= 1;
      } else {
        if (half === 1) half = 0;
        else {
          monthStart = monthStart.minus({ months: 1 });
          half = 1;
        }
        steps += 1;
      }
    }
    const start =
      half === 0
        ? monthStart.set({ day: 1 }).startOf("day")
        : monthStart.set({ day: 16 }).startOf("day");
    const end =
      half === 0
        ? monthStart.set({ day: 16 }).startOf("day")
        : monthStart.plus({ months: 1 }).startOf("month");
    return {
      preset: "FORTNIGHT",
      timezone: tz,
      startUtc: start.toUTC().toJSDate(),
      endUtc: end.toUTC().toJSDate(),
      label:
        half === 0
          ? `1ª quinzena de ${capitalize(MONTH_NAMES_PT[monthStart.month - 1]!)}/${monthStart.year}`
          : `2ª quinzena de ${capitalize(MONTH_NAMES_PT[monthStart.month - 1]!)}/${monthStart.year}`,
      periodKey: `rec-F:${monthStart.toFormat("yyyy-LL")}-H${half + 1}`,
      anchorIso: start.toFormat("yyyy-LL-dd"),
    };
  }

  const monthStart = cursor.startOf("month");
  const half = cursor.day <= 15 ? 0 : 1;
  const start =
    half === 0
      ? monthStart.set({ day: 1 }).startOf("day")
      : monthStart.set({ day: 16 }).startOf("day");
  const end =
    half === 0
      ? monthStart.set({ day: 16 }).startOf("day")
      : monthStart.plus({ months: 1 }).startOf("month");
  return {
    preset: "FORTNIGHT",
    timezone: tz,
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
    label:
      half === 0
        ? `1ª quinzena de ${capitalize(MONTH_NAMES_PT[monthStart.month - 1]!)}/${monthStart.year}`
        : `2ª quinzena de ${capitalize(MONTH_NAMES_PT[monthStart.month - 1]!)}/${monthStart.year}`,
    periodKey: `rec-F:${monthStart.toFormat("yyyy-LL")}-H${half + 1}`,
    anchorIso: start.toFormat("yyyy-LL-dd"),
  };
}

export type CollaboratorAttendanceDetail = {
  consumptionId: string;
  patientId: string;
  patientName: string;
  attendanceDateIso: string;
  sessionValueCents: number;
  serviceName: string | null;
};

export type CollaboratorPayoutHistoryItem = {
  payoutId: string;
  amountCents: number;
  paidAtIso: string;
  method: string;
  notes: string | null;
  transactionId: string;
};

export type CollaboratorBalanceLine = {
  intraUserId: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  commissionRateBps: number;
  attendanceCount: number;
  baseCents: number;
  commissionDueCents: number;
  paidCents: number;
  balanceCents: number;
  attendances: CollaboratorAttendanceDetail[];
  payouts: CollaboratorPayoutHistoryItem[];
};

export function buildCollaboratorBalanceLine(input: {
  intraUserId: string;
  name: string;
  color: string;
  role: "ADMIN" | "MEMBER";
  commissionRateBps: number;
  attendanceCount: number;
  baseCents: number;
  paidCents: number;
  attendances?: CollaboratorAttendanceDetail[];
  payouts?: CollaboratorPayoutHistoryItem[];
}): CollaboratorBalanceLine {
  const commissionDueCents = commissionCentsFromBase(
    input.baseCents,
    input.commissionRateBps,
  );
  const paidCents = Math.max(0, Math.trunc(input.paidCents));
  return {
    intraUserId: input.intraUserId,
    name: input.name,
    color: input.color,
    role: input.role,
    commissionRateBps: Math.min(10_000, Math.max(0, Math.trunc(input.commissionRateBps))),
    attendanceCount: Math.max(0, Math.trunc(input.attendanceCount)),
    baseCents: Math.max(0, Math.trunc(input.baseCents)),
    commissionDueCents,
    paidCents,
    balanceCents: Math.max(0, commissionDueCents - paidCents),
    attendances: input.attendances ?? [],
    payouts: input.payouts ?? [],
  };
}
