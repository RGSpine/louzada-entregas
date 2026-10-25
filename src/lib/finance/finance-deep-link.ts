/**
 * Deep-links do Consultório Financeiro (`/dashboard/finances?...`).
 * Usado pela Agenda (projeção) e pela ficha (pagamento pendente).
 */
import {
  FINANCE_PERIOD_PRESETS,
  type FinancePeriodPreset,
} from "@/lib/finance/period";

export type FinanceDeepLinkParams = {
  tab?: "catalogo" | "registrar" | "analisar" | "configurar" | "fiscal";
  patientId?: string;
  purchaseId?: string;
  /** collect = abrir cobrança na aba Analisar; pending = destacar pendências */
  action?: "collect" | "pending";
  /** yyyy-MM-dd (início inclusivo, fuso local) */
  from?: string;
  /** yyyy-MM-dd (fim inclusivo) */
  to?: string;
  preset?: FinancePeriodPreset;
  /** Âncora do preset (ex. início da semana da agenda) */
  anchorIso?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function buildFinanceDeepLink(params: FinanceDeepLinkParams): string {
  const q = new URLSearchParams();
  if (params.tab) q.set("tab", params.tab);
  if (params.patientId) q.set("patientId", params.patientId);
  if (params.purchaseId) q.set("purchaseId", params.purchaseId);
  if (params.action) q.set("action", params.action);
  if (params.from && isValidIsoDate(params.from)) q.set("from", params.from);
  if (params.to && isValidIsoDate(params.to)) q.set("to", params.to);
  if (params.preset && (FINANCE_PERIOD_PRESETS as readonly string[]).includes(params.preset)) {
    q.set("preset", params.preset);
  }
  if (params.anchorIso && isValidIsoDate(params.anchorIso)) q.set("anchor", params.anchorIso);
  const qs = q.toString();
  return qs ? `/dashboard/finances?${qs}` : "/dashboard/finances";
}

export type ParsedFinanceDeepLink = {
  tab: FinanceDeepLinkParams["tab"] | null;
  patientId: string | null;
  purchaseId: string | null;
  action: "collect" | "pending" | null;
  from: string | null;
  to: string | null;
  preset: FinancePeriodPreset | null;
  anchorIso: string | null;
};

export function parseFinanceDeepLink(
  search: string | URLSearchParams,
): ParsedFinanceDeepLink {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const tabRaw = q.get("tab");
  const tabs = ["catalogo", "registrar", "analisar", "configurar", "fiscal"] as const;
  const tab = tabs.includes(tabRaw as (typeof tabs)[number])
    ? (tabRaw as (typeof tabs)[number])
    : null;

  const actionRaw = q.get("action");
  const action =
    actionRaw === "collect" || actionRaw === "pending" ? actionRaw : null;

  const presetRaw = q.get("preset");
  const preset =
    presetRaw && (FINANCE_PERIOD_PRESETS as readonly string[]).includes(presetRaw)
      ? (presetRaw as FinancePeriodPreset)
      : null;

  const from = q.get("from");
  const to = q.get("to");
  const anchor = q.get("anchor");

  return {
    tab,
    patientId: q.get("patientId"),
    purchaseId: q.get("purchaseId"),
    action,
    from: from && isValidIsoDate(from) ? from : null,
    to: to && isValidIsoDate(to) ? to : null,
    preset,
    anchorIso: anchor && isValidIsoDate(anchor) ? anchor : null,
  };
}

/** Link Agenda (semana) → extrato financeiro na mesma semana. */
export function buildAgendaWeekFinanceLink(weekStartIso: string): string {
  return buildFinanceDeepLink({
    tab: "analisar",
    preset: "WEEK",
    anchorIso: weekStartIso,
    from: weekStartIso,
  });
}
