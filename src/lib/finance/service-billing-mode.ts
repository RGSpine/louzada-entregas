import { DateTime } from "luxon";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@/lib/schedule-temporal-parse";

export type ServiceBillingModeValue = "SESSION" | "MONTHLY";

const MONTHLY_BILLING_RE =
  /\b(mensalidade|mensalidades|assinatura\s+mensal|plano\s+mensal|valor\s+mensal|cobranca\s+mensal|cobrança\s+mensal|por\s+mes|por\s+mês|\/\s*mes|\/\s*mês|ao\s+mes|ao\s+mês|mensalmente)\b/i;

const SESSION_PACKAGE_RE =
  /\b(\d{1,3})\s*(sess(o|õ)es|atendimentos|consultas)\b/i;

/**
 * Normaliza texto para heurísticas (remove acentos).
 */
export function normalizeBillingText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Detecta cobrança mensal em nome/descrição/áudio/OCR.
 * Se houver N sessões explícito no texto, SESSION vence (pacote clássico).
 */
export function detectServiceBillingModeFromText(
  ...parts: Array<string | null | undefined>
): ServiceBillingModeValue {
  const joined = parts.filter(Boolean).join(" \n ");
  if (!joined.trim()) return "SESSION";
  const normalized = normalizeBillingText(joined);

  if (SESSION_PACKAGE_RE.test(normalized) && !MONTHLY_BILLING_RE.test(normalized)) {
    return "SESSION";
  }
  // "plano de 8 sessões mensais" / "8 sessões por mês" → SESSION (controle por sessão)
  if (SESSION_PACKAGE_RE.test(normalized) && /\bpor\s+mes\b/.test(normalized)) {
    return "SESSION";
  }
  if (MONTHLY_BILLING_RE.test(normalized)) {
    return "MONTHLY";
  }
  return "SESSION";
}

export function resolveMonthlyPeriodBounds(
  anchor: Date,
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): { periodStart: Date; periodEnd: Date } {
  const dt = DateTime.fromJSDate(anchor, { zone: "utc" }).setZone(timezone);
  const start = dt.startOf("month");
  const end = start.plus({ months: 1 });
  return {
    periodStart: start.toUTC().toJSDate(),
    periodEnd: end.toUTC().toJSDate(),
  };
}

/**
 * Segunda metade do período da mensalidade (ainda vigente).
 * Ex.: mês civil → a partir do dia ~15/16 até o fim do mês.
 */
export function isMonthlyPlanMidPeriod(params: {
  periodStart: Date;
  periodEnd: Date;
  now?: Date;
}): boolean {
  const now = params.now ?? new Date();
  const startMs = params.periodStart.getTime();
  const endMs = params.periodEnd.getTime();
  if (!(endMs > startMs)) return false;
  if (now.getTime() < startMs || now.getTime() >= endMs) return false;
  const midMs = startMs + Math.floor((endMs - startMs) / 2);
  return now.getTime() >= midMs;
}

export function formatMonthlyMidPeriodWarning(input: {
  patientName?: string | null;
  serviceName?: string | null;
  periodEnd?: Date | null;
}): string {
  const patient = input.patientName?.trim() ? `${input.patientName.trim()}: ` : "";
  const service = input.serviceName?.trim() ? ` «${input.serviceName.trim()}»` : "";
  const endLabel = input.periodEnd
    ? DateTime.fromJSDate(input.periodEnd, { zone: "utc" })
        .setZone(DEFAULT_SCHEDULE_TIMEZONE)
        .minus({ days: 1 })
        .toFormat("dd/LL")
    : null;
  const until = endLabel ? ` (vigência até ${endLabel})` : "";
  return `${patient}meio da mensalidade${service}${until}. Bom momento para confirmar renovação ou próximos atendimentos.`;
}
