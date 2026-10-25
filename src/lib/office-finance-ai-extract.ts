import type { Part } from "@google/generative-ai";
import { z } from "zod";
import type { FinancialTransactionMethod, RecurringExpenseFrequency } from "@prisma/client";
import { generateContentSafeWithModelFallback } from "@/lib/gemini";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import { logger } from "@/lib/logger";
import { sanitizeText } from "@/lib/sanitize";
import {
  CATALOG_SERVICE_DESCRIPTION_MAX,
  normalizeCatalogServiceFields,
} from "@/lib/finance/catalog-service-name";
import {
  extractTargetPromptBlock,
  type OfficeFinanceExtractTarget,
} from "@/lib/office-finance-extract-target";
import {
  expandPortugueseSessionDateMentions,
  mergePerformedSessionDateGuesses,
} from "@/lib/finance/portuguese-session-dates";
import {
  formatPaymentNotes,
  inferPortuguesePayment,
  normalizePaymentMethodToken,
} from "@/lib/finance/portuguese-payment";
import { detectServiceBillingModeFromText } from "@/lib/finance/service-billing-mode";

/** Saída esperada do modelo (JSON). */
export const officeFinanceModelOutputSchema = z.object({
  recordType: z.enum([
    "patient_sale",
    "standalone_transaction",
    "catalog_service",
    "recurring_expense",
    "unclear",
  ]),
  patientNameGuess: z.string().max(200).nullable().optional(),
  professionalServiceGuess: z.string().max(200).nullable().optional(),
  serviceDescriptionGuess: z.string().max(4000).nullable().optional(),
  purchaseTypeGuess: z.enum(["SINGLE", "PACKAGE"]).nullable().optional(),
  packageSessionsGuess: z.number().int().min(2).max(200).nullable().optional(),
  /** SESSION = por sessão/pacote; MONTHLY = mensalidade (pilates, acompanhamento…). */
  billingModeGuess: z.enum(["SESSION", "MONTHLY"]).nullable().optional(),
  /**
   * Datas de sessões JÁ realizadas (áudio/nota). Ordem cronológica.
   * Ex.: ["21/07/2026", "08/08/2026"] ou yyyy-mm-dd.
   */
  performedSessionDatesGuess: z.array(z.string().max(64)).max(200).nullable().optional(),
  /** Contagem de sessões já feitas, se o áudio não listar todas as datas. */
  performedSessionsCountGuess: z.number().int().min(0).max(200).nullable().optional(),
  /**
   * new_sale = criar/vincular plano; mark_sessions_done = baixar sessões de plano já existente.
   */
  saleActionGuess: z.enum(["new_sale", "mark_sessions_done"]).nullable().optional(),
  recurringNameGuess: z.string().max(200).nullable().optional(),
  categoryGuess: z.string().max(100).nullable().optional(),
  frequencyGuess: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).nullable().optional(),
  anchorDayGuess: z.number().int().min(1).max(28).nullable().optional(),
  /** Valor em reais (ex.: 350.5) ou null se incerto. */
  agreedAmountReais: z.number().nonnegative().nullable().optional(),
  transactionKindGuess: z.enum(["INCOME", "EXPENSE"]).nullable().optional(),
  paymentMethodGuess: z
    .enum(["CASH", "PIX", "CARD", "TRANSFER", "OTHER"])
    .nullable()
    .optional(),
  /**
   * Parcelas no cartão de crédito (2–48). null = à vista / não mencionado.
   */
  installmentCountGuess: z.number().int().min(2).max(48).nullable().optional(),
  /** CREDIT | DEBIT quando o áudio distingue; null se só "cartão". */
  cardKindGuess: z.enum(["CREDIT", "DEBIT"]).nullable().optional(),
  occurredDateGuess: z.string().max(64).nullable().optional(),
  registerSalePaymentGuess: z.boolean().nullable().optional(),
  narrativeSummaryPt: z.string().max(800).nullable().optional(),
  confidenceOverall: z.number().min(0).max(1),
});

export type OfficeFinanceModelOutput = z.infer<typeof officeFinanceModelOutputSchema>;

export type OfficeFinanceContextPatient = { id: string; name: string };
export type OfficeFinanceContextService = {
  id: string;
  name: string;
  defaultPriceCents: number;
};

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    return null;
  }
}

const RECORD_TYPE_VALUES = [
  "patient_sale",
  "standalone_transaction",
  "catalog_service",
  "recurring_expense",
  "unclear",
] as const;

type RecordTypeValue = (typeof RECORD_TYPE_VALUES)[number];

const RECORD_TYPE_ALIASES: Record<string, RecordTypeValue> = {
  patient_sale: "patient_sale",
  sale: "patient_sale",
  venda: "patient_sale",
  standalone_transaction: "standalone_transaction",
  standalone: "standalone_transaction",
  transaction: "standalone_transaction",
  lancamento: "standalone_transaction",
  catalog_service: "catalog_service",
  catalog: "catalog_service",
  catalogo: "catalog_service",
  catálogo: "catalog_service",
  service: "catalog_service",
  servico: "catalog_service",
  serviço: "catalog_service",
  recurring_expense: "recurring_expense",
  recurring: "recurring_expense",
  expense: "recurring_expense",
  gasto_fixo: "recurring_expense",
  unclear: "unclear",
};

function coerceNumber(
  value: unknown,
  opts?: { int?: boolean; min?: number; max?: number },
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    let n = opts?.int ? Math.round(value) : value;
    if (opts?.min !== undefined) n = Math.max(opts.min, n);
    if (opts?.max !== undefined) n = Math.min(opts.max, n);
    return n;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const noCurrency = trimmed.replace(/[R$\s]/gi, "");
    let n: number;
    if (/,/.test(noCurrency)) {
      n = Number(noCurrency.replace(/\./g, "").replace(",", "."));
    } else if (/^\d+\.\d{1,3}$/.test(noCurrency)) {
      n = Number(noCurrency);
    } else {
      n = Number(noCurrency.replace(/\./g, ""));
    }
    if (Number.isFinite(n)) return coerceNumber(n, opts);
  }
  return null;
}

function coerceStringOrNull(value: unknown, maxLen: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") return value.trim().slice(0, maxLen) || null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).slice(0, maxLen);
  }
  return null;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  aliases: Record<string, T>,
): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const key = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  const mapped = aliases[key] ?? (key.toUpperCase() as T);
  return allowed.includes(mapped) ? mapped : null;
}

const FREQUENCY_ALIASES: Record<string, RecurringExpenseFrequency> = {
  weekly: "WEEKLY",
  semanal: "WEEKLY",
  month: "MONTHLY",
  monthly: "MONTHLY",
  mensal: "MONTHLY",
  yearly: "YEARLY",
  annual: "YEARLY",
  anual: "YEARLY",
};

const PURCHASE_ALIASES: Record<string, "SINGLE" | "PACKAGE"> = {
  single: "SINGLE",
  avulso: "SINGLE",
  unitario: "SINGLE",
  unitário: "SINGLE",
  package: "PACKAGE",
  pacote: "PACKAGE",
};

const TRANSACTION_KIND_ALIASES: Record<string, "INCOME" | "EXPENSE"> = {
  income: "INCOME",
  receita: "INCOME",
  entrada: "INCOME",
  expense: "EXPENSE",
  despesa: "EXPENSE",
  saida: "EXPENSE",
  saída: "EXPENSE",
};

function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = coerceStringOrNull(obj[key], 400);
    if (v) return v;
  }
  return null;
}

export type SuggestedCatalogItem = {
  name: string;
  description: string | null;
  defaultPriceCents: number | null;
  billingMode: "SESSION" | "MONTHLY";
};

function rowToCatalogItem(row: Record<string, unknown>): SuggestedCatalogItem | null {
  const rawName = pickFirstString(row, [
    "name",
    "nome",
    "service",
    "servico",
    "serviço",
    "professionalServiceGuess",
    "titulo",
    "título",
  ]);
  if (!rawName) return null;
  const rawDescription =
    pickFirstString(row, ["description", "descricao", "descrição", "serviceDescriptionGuess"]) ??
    null;
  const { name, description } = normalizeCatalogServiceFields(rawName, rawDescription);
  if (!name) return null;
  const price = coerceNumber(
    row.price ?? row.valor ?? row.preco ?? row.preço ?? row.agreedAmountReais ?? row.defaultPrice,
    { min: 0 },
  );
  const billingRaw = pickFirstString(row, ["billingMode", "billingModeGuess", "cobranca", "cobrança"]);
  const billingMode =
    billingRaw?.toUpperCase() === "MONTHLY"
      ? "MONTHLY"
      : billingRaw?.toUpperCase() === "SESSION"
        ? "SESSION"
        : detectServiceBillingModeFromText(name, description);
  return {
    name,
    description,
    defaultPriceCents: price != null ? Math.round(price * 100) : null,
    billingMode,
  };
}

function parseCatalogItemsFromSummary(summary: string): SuggestedCatalogItem[] {
  const items: SuggestedCatalogItem[] = [];
  for (const part of summary.split(/[;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const withPrice = /^(.*?)\s*\(R\$\s*([\d.,]+)\)\s*$/i.exec(trimmed);
    if (withPrice) {
      const price = coerceNumber(withPrice[2], { min: 0 });
      const rawName = withPrice[1]?.trim();
      if (!rawName) continue;
      const { name, description } = normalizeCatalogServiceFields(rawName);
      if (!name) continue;
      items.push({
        name,
        description,
        defaultPriceCents: price != null ? Math.round(price * 100) : null,
        billingMode: detectServiceBillingModeFromText(name, description),
      });
      continue;
    }
    if (trimmed.length >= 2) {
      const { name, description } = normalizeCatalogServiceFields(trimmed);
      if (!name) continue;
      items.push({
        name,
        description,
        defaultPriceCents: null,
        billingMode: detectServiceBillingModeFromText(name, description),
      });
    }
  }
  return items;
}

/** Extrai todos os serviços de tabelas/arrays no JSON bruto do modelo (antes do Zod). */
export function extractCatalogItemsFromJson(raw: unknown): SuggestedCatalogItem[] {
  const items: SuggestedCatalogItem[] = [];
  const seen = new Set<string>();

  function addItem(item: SuggestedCatalogItem | null) {
    if (!item?.name?.trim()) return;
    const key = normalizeForMatch(item.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  if (!raw || typeof raw !== "object") return items;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === "object") {
        addItem(rowToCatalogItem(entry as Record<string, unknown>));
      }
    }
    return items;
  }

  const obj = raw as Record<string, unknown>;
  for (const key of [
    "services",
    "catalogItems",
    "catalog_services",
    "items",
    "produtos",
    "servicos",
    "serviços",
  ]) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (entry && typeof entry === "object") {
        addItem(rowToCatalogItem(entry as Record<string, unknown>));
      }
    }
    if (items.length > 0) return items;
  }

  addItem(rowToCatalogItem(obj));
  return items;
}

function mergeCatalogItems(
  primary: SuggestedCatalogItem[],
  extra: SuggestedCatalogItem[],
): SuggestedCatalogItem[] {
  const out = [...primary];
  const seen = new Set(primary.map((i) => normalizeForMatch(i.name)));
  for (const item of extra) {
    const key = normalizeForMatch(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function summarizeCatalogItems(items: unknown[]): string | null {
  const parts: string[] = [];
  for (const item of items.slice(1, 8)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = pickFirstString(row, ["name", "nome", "service", "servico", "serviço", "professionalServiceGuess"]);
    const price = coerceNumber(
      row.price ?? row.valor ?? row.preco ?? row.preço ?? row.agreedAmountReais,
      { min: 0 },
    );
    if (!name) continue;
    parts.push(price != null ? `${name} (R$ ${price.toFixed(2)})` : name);
  }
  return parts.length ? parts.join("; ") : null;
}

function unwrapModelObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;

  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const first = raw[0];
    return first && typeof first === "object" ? unwrapModelObject(first) : null;
  }

  const obj = raw as Record<string, unknown>;

  for (const key of ["catalogItem", "catalogService", "service", "firstService", "result", "data"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return { ...obj, ...(nested as Record<string, unknown>) };
    }
  }

  for (const key of ["services", "catalogItems", "catalog_services", "items", "produtos", "servicos", "serviços"]) {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0];
    if (!first || typeof first !== "object") continue;
    const row = first as Record<string, unknown>;
    const restSummary = summarizeCatalogItems(arr);
    return {
      ...obj,
      recordType: "catalog_service",
      professionalServiceGuess:
        pickFirstString(row, ["name", "nome", "service", "servico", "serviço", "professionalServiceGuess"]) ??
        obj.professionalServiceGuess,
      serviceDescriptionGuess:
        pickFirstString(row, ["description", "descricao", "descrição", "serviceDescriptionGuess"]) ??
        obj.serviceDescriptionGuess,
      agreedAmountReais:
        row.price ?? row.valor ?? row.preco ?? row.preço ?? row.agreedAmountReais ?? obj.agreedAmountReais,
      narrativeSummaryPt:
        restSummary ??
        coerceStringOrNull(obj.narrativeSummaryPt, 800) ??
        null,
    };
  }

  return obj;
}

/**
 * Corrige formatos comuns do Gemini (strings pt-BR, aliases, arrays de catálogo) antes do Zod.
 */
export function normalizeOfficeFinanceModelJson(
  raw: unknown,
  extractTarget: OfficeFinanceExtractTarget = "auto",
): unknown {
  const obj = unwrapModelObject(raw);
  if (!obj) return raw;

  const out: Record<string, unknown> = { ...obj };

  if (!out.professionalServiceGuess) {
    const name = pickFirstString(obj, [
      "name",
      "nome",
      "serviceName",
      "service",
      "servico",
      "serviço",
      "titulo",
      "título",
    ]);
    if (name) out.professionalServiceGuess = name;
  }

  if (!out.agreedAmountReais) {
    for (const key of ["price", "valor", "preco", "preço", "defaultPrice", "amount", "valorReais"]) {
      if (obj[key] !== undefined) {
        out.agreedAmountReais = obj[key];
        break;
      }
    }
  }

  const recordType = typeof obj.recordType === "string" ? obj.recordType : "";
  const rtKey = recordType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  const mappedRecordType = RECORD_TYPE_ALIASES[rtKey];
  if (mappedRecordType) {
    out.recordType = mappedRecordType;
  } else if (RECORD_TYPE_VALUES.includes(recordType as RecordTypeValue)) {
    out.recordType = recordType;
  } else if (extractTarget === "catalog") {
    out.recordType = "catalog_service";
  } else if (extractTarget === "recurring") {
    out.recordType = "recurring_expense";
  } else if (extractTarget === "purchase") {
    out.recordType = "patient_sale";
  } else if (extractTarget === "standalone") {
    out.recordType = "standalone_transaction";
  } else {
    out.recordType = "unclear";
  }

  if (
    extractTarget === "catalog" &&
    out.recordType === "unclear" &&
    (out.professionalServiceGuess || out.recurringNameGuess || out.agreedAmountReais != null)
  ) {
    out.recordType = "catalog_service";
  }

  out.confidenceOverall = coerceNumber(obj.confidenceOverall, { min: 0, max: 1 }) ?? 0.55;
  out.agreedAmountReais = coerceNumber(out.agreedAmountReais, { min: 0 });

  const stringFields: Array<[string, number]> = [
    ["patientNameGuess", 200],
    ["professionalServiceGuess", 200],
    ["serviceDescriptionGuess", 4000],
    ["recurringNameGuess", 200],
    ["categoryGuess", 100],
    ["occurredDateGuess", 64],
    ["narrativeSummaryPt", 800],
  ];
  for (const [key, maxLen] of stringFields) {
    if (key in obj) out[key] = coerceStringOrNull(obj[key], maxLen);
  }

  if (typeof out.professionalServiceGuess === "string" && out.professionalServiceGuess.length > 0) {
    const { name, description } = normalizeCatalogServiceFields(
      out.professionalServiceGuess,
      typeof out.serviceDescriptionGuess === "string" ? out.serviceDescriptionGuess : null,
    );
    out.professionalServiceGuess = name || null;
    if (description) {
      out.serviceDescriptionGuess = description.slice(0, CATALOG_SERVICE_DESCRIPTION_MAX);
    }
  }

  if ("packageSessionsGuess" in obj) {
    out.packageSessionsGuess = coerceNumber(obj.packageSessionsGuess, { int: true, min: 2, max: 200 });
  }
  if ("billingModeGuess" in obj) {
    const raw = coerceStringOrNull(obj.billingModeGuess, 32)?.toUpperCase();
    out.billingModeGuess =
      raw === "MONTHLY" || raw === "SESSION" ? raw : null;
  }
  if ("performedSessionsCountGuess" in obj) {
    out.performedSessionsCountGuess = coerceNumber(obj.performedSessionsCountGuess, {
      int: true,
      min: 0,
      max: 200,
    });
  }
  if ("performedSessionDatesGuess" in obj) {
    const rawDates = obj.performedSessionDatesGuess;
    if (Array.isArray(rawDates)) {
      out.performedSessionDatesGuess = rawDates
        .map((d) => coerceStringOrNull(d, 64))
        .filter((d): d is string => Boolean(d))
        .slice(0, 200);
    } else if (typeof rawDates === "string" && rawDates.trim()) {
      out.performedSessionDatesGuess = rawDates
        .split(/[,;]| e /i)
        .map((d) => d.trim())
        .filter(Boolean)
        .slice(0, 200);
    } else {
      out.performedSessionDatesGuess = null;
    }
  }
  if ("anchorDayGuess" in obj) {
    const day = coerceNumber(obj.anchorDayGuess, { int: true });
    out.anchorDayGuess = day != null ? Math.min(28, Math.max(1, day)) : null;
  }

  out.purchaseTypeGuess = normalizeEnum(obj.purchaseTypeGuess, ["SINGLE", "PACKAGE"] as const, PURCHASE_ALIASES);
  out.frequencyGuess = normalizeEnum(
    obj.frequencyGuess,
    ["WEEKLY", "MONTHLY", "YEARLY"] as const,
    FREQUENCY_ALIASES,
  );

  const paymentFromModel = normalizePaymentMethodToken(
    obj.paymentMethodGuess ?? obj.payment_method ?? obj.formaPagamento ?? obj.method,
  );
  const installmentRaw =
    obj.installmentCountGuess ??
    obj.installmentsGuess ??
    obj.parcelasGuess ??
    obj.parcelas ??
    obj.installments;
  const narrativeForPayment = [
    coerceStringOrNull(obj.narrativeSummaryPt, 800) ?? "",
    typeof obj.paymentMethodGuess === "string" ? obj.paymentMethodGuess : "",
    typeof installmentRaw === "string" ? installmentRaw : "",
  ]
    .filter(Boolean)
    .join(" ");
  const paymentInferred = inferPortuguesePayment({
    text: narrativeForPayment,
    methodToken: paymentFromModel ?? obj.paymentMethodGuess,
    installmentToken: installmentRaw,
  });
  out.paymentMethodGuess = paymentInferred.method ?? null;
  out.installmentCountGuess = paymentInferred.installmentCount;
  out.cardKindGuess = paymentInferred.cardKind;

  out.transactionKindGuess = normalizeEnum(
    obj.transactionKindGuess,
    ["INCOME", "EXPENSE"] as const,
    TRANSACTION_KIND_ALIASES,
  );

  if (typeof obj.registerSalePaymentGuess === "boolean") {
    out.registerSalePaymentGuess = obj.registerSalePaymentGuess;
  } else if (typeof obj.registerSalePaymentGuess === "string") {
    const s = obj.registerSalePaymentGuess.toLowerCase();
    out.registerSalePaymentGuess = s === "true" || s === "sim" || s === "yes" ? true : s === "false" || s === "nao" || s === "não" || s === "no" ? false : null;
  }

  if ("saleActionGuess" in obj || "sale_action" in obj || "acaoVenda" in obj) {
    const raw =
      obj.saleActionGuess ?? obj.sale_action ?? obj.acaoVenda ?? obj.actionGuess;
    const s = String(raw ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");
    if (
      s === "mark_sessions_done" ||
      s === "update_sessions" ||
      s === "atualizar_sessoes" ||
      s === "marcar_realizadas" ||
      s === "baixa_sessoes"
    ) {
      out.saleActionGuess = "mark_sessions_done";
    } else if (
      s === "new_sale" ||
      s === "create_purchase" ||
      s === "nova_venda" ||
      s === "criar_plano"
    ) {
      out.saleActionGuess = "new_sale";
    } else {
      out.saleActionGuess = null;
    }
  }

  return out;
}

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePatientIdFromGuess(
  guess: string | null | undefined,
  patients: OfficeFinanceContextPatient[],
): { id: string; name: string } | null {
  if (!guess || patients.length === 0) return null;
  const g = normalizeForMatch(guess);
  if (!g) return null;
  for (const p of patients) {
    const n = normalizeForMatch(p.name);
    if (n === g || n.includes(g) || g.includes(n)) {
      return { id: p.id, name: p.name };
    }
  }
  const gTokens = g.split(" ").filter((t) => t.length > 2);
  let best: { id: string; name: string; score: number } | null = null;
  for (const p of patients) {
    const n = normalizeForMatch(p.name);
    let score = 0;
    for (const t of gTokens) {
      if (n.includes(t)) score += t.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: p.id, name: p.name, score };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export function resolveServiceIdFromGuess(
  guess: string | null | undefined,
  services: OfficeFinanceContextService[],
): { id: string; name: string } | null {
  if (!guess || services.length === 0) return null;
  const g = normalizeForMatch(guess);
  if (!g) return null;
  for (const s of services) {
    const n = normalizeForMatch(s.name);
    if (n === g || n.includes(g) || g.includes(n)) {
      return { id: s.id, name: s.name };
    }
  }
  return null;
}

/** Converte entrada livre pt-BR / ISO para `yyyy-mm-dd` no fuso local de interpretação simples. */
export function coerceDateGuessToYyyyMmDd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const brFull = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (brFull) {
    const dd = brFull[1]!.padStart(2, "0");
    const mm = brFull[2]!.padStart(2, "0");
    let yy = brFull[3]!;
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  // Áudio costuma omitir o ano: "21/07", "8/8".
  const brShort = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (brShort) {
    const dd = Number(brShort[1]);
    const mm = Number(brShort[2]);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, mm - 1, dd, 12, 0, 0, 0);
    // Sessão histórica: se a data “cair” no futuro, assume ano anterior.
    if (candidate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      year -= 1;
    }
    return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  // "08 de julho", "8 de julho de 2026"
  const fromPt = expandPortugueseSessionDateMentions(s);
  if (fromPt.length === 1) return fromPt[0]!;
  return null;
}

/**
 * Normaliza lista de datas de sessões já realizadas (ordem cronológica, sem duplicatas).
 */
export function coercePerformedSessionDates(
  dates: string[] | null | undefined,
  narrativeText?: string | null,
): string[] {
  return mergePerformedSessionDateGuesses({
    modelDates: dates,
    narrativeText,
    coerceDate: coerceDateGuessToYyyyMmDd,
  });
}

function reaisToCents(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export type OfficeFinanceExtractionEnvelope = {
  model: OfficeFinanceModelOutput;
  resolvedPatientId: string | null;
  resolvedProfessionalServiceId: string | null;
  suggestedAgreedPriceCents: number | null;
  suggestedStandaloneAmountCents: number | null;
  suggestedOccurredYyyyMmDd: string | null;
  /**
   * Datas (yyyy-mm-dd) de sessões do pacote já realizadas, na ordem cronológica.
   * Usado na ficha do paciente para marcar CONSUMED ao confirmar a venda
   * ou ao atualizar sessões de um plano já existente.
   */
  suggestedPerformedSessionYyyyMmDd: string[];
  /**
   * new_sale = criar vínculo/plano; mark_sessions_done = baixar sessões PENDING de compra existente.
   */
  suggestedSaleAction: "new_sale" | "mark_sessions_done";
  /** Parcelas no crédito (2–48), se o áudio/texto indicar. */
  suggestedInstallmentCount: number | null;
  /** Rótulo curto p/ notas (ex.: "Cartão de crédito em 5x"). */
  suggestedPaymentNote: string | null;
  suggestedCatalog: {
    name: string;
    description: string | null;
    defaultPriceCents: number | null;
    billingMode: "SESSION" | "MONTHLY";
  } | null;
  /** Todos os serviços extraídos (PDF com várias linhas, arrays do modelo, etc.). */
  suggestedCatalogItems: SuggestedCatalogItem[];
  suggestedRecurring: {
    name: string;
    amountCents: number | null;
    category: string | null;
    frequency: RecurringExpenseFrequency;
    anchorDay: number;
    method: FinancialTransactionMethod;
  } | null;
  warnings: string[];
};

export function envelopeFromModelOutput(
  parsed: OfficeFinanceModelOutput,
  patients: OfficeFinanceContextPatient[],
  services: OfficeFinanceContextService[],
  extractedCatalogItems: SuggestedCatalogItem[] = [],
): OfficeFinanceExtractionEnvelope {
  const warnings: string[] = [];

  const patientMatch = resolvePatientIdFromGuess(parsed.patientNameGuess ?? null, patients);
  if (
    parsed.recordType === "patient_sale" &&
    (parsed.patientNameGuess?.trim()?.length ?? 0) > 0 &&
    !patientMatch
  ) {
    warnings.push("Cliente mencionado não foi relacionado à lista do laboratório; escolha manualmente.");
  }

  let resolvedServiceId: string | null = null;
  if (parsed.recordType === "patient_sale") {
    const svc = resolveServiceIdFromGuess(parsed.professionalServiceGuess ?? null, services);
    resolvedServiceId = svc?.id ?? null;
    if (
      (parsed.professionalServiceGuess?.trim()?.length ?? 0) > 0 &&
      parsed.recordType === "patient_sale" &&
      !resolvedServiceId
    ) {
      warnings.push("Serviço mencionado não casou com o catálogo; escolha manualmente ou cadastre o serviço.");
    }
  }

  const cents = reaisToCents(parsed.agreedAmountReais ?? null);

  let suggestedOccurred = coerceDateGuessToYyyyMmDd(parsed.occurredDateGuess ?? null);
  if (!suggestedOccurred && parsed.recordType !== "unclear") {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    suggestedOccurred = `${y}-${m}-${da}`;
    if (parsed.occurredDateGuess?.trim()) {
      warnings.push("Data reconhecida de forma ambígua — verifique na forma.");
    }
  }

  // Laboratório: cada venda é um trabalho (coleta ou entrega), sem pacote de sessões.
  const suggestedPerformedSessionYyyyMmDd: string[] = [];
  const suggestedSaleAction = "new_sale" as const;
  if (parsed.recordType === "patient_sale") {
    parsed.purchaseTypeGuess = "SINGLE";
    parsed.packageSessionsGuess = null;
    parsed.saleActionGuess = "new_sale";
    parsed.performedSessionDatesGuess = null;
    parsed.performedSessionsCountGuess = null;
  }

  if (parsed.confidenceOverall < 0.45) {
    warnings.push("Confiança da extração foi baixa; confira todos os campos antes de guardar.");
  }

  const summary = parsed.narrativeSummaryPt?.trim()
    ? sanitizeText(parsed.narrativeSummaryPt)
    : null;

  let suggestedCatalog: OfficeFinanceExtractionEnvelope["suggestedCatalog"] = null;
  let suggestedCatalogItems: SuggestedCatalogItem[] = [...extractedCatalogItems];

  if (parsed.recordType === "catalog_service") {
    const rawName =
      parsed.professionalServiceGuess?.trim() ||
      parsed.recurringNameGuess?.trim() ||
      "";
    const { name, description } = normalizeCatalogServiceFields(
      rawName,
      parsed.serviceDescriptionGuess?.trim() || null,
    );
    if (name) {
      if (rawName.length > name.length) {
        warnings.push(
          "Nome do serviço foi encurtado para 200 caracteres; detalhes extras foram movidos para a descrição.",
        );
      }
      suggestedCatalog = {
        name,
        description,
        defaultPriceCents: cents,
        billingMode:
          parsed.billingModeGuess === "MONTHLY" || parsed.billingModeGuess === "SESSION"
            ? parsed.billingModeGuess
            : detectServiceBillingModeFromText(name, description),
      };
      suggestedCatalogItems = mergeCatalogItems(
        suggestedCatalog ? [suggestedCatalog] : [],
        suggestedCatalogItems,
      );
    } else {
      warnings.push("Nome do serviço não identificado — preencha manualmente.");
    }

    if (summary) {
      suggestedCatalogItems = mergeCatalogItems(
        suggestedCatalogItems,
        parseCatalogItemsFromSummary(summary),
      );
    }
  }

  let suggestedRecurring: OfficeFinanceExtractionEnvelope["suggestedRecurring"] = null;
  if (parsed.recordType === "recurring_expense") {
    const recName = parsed.recurringNameGuess?.trim() || parsed.narrativeSummaryPt?.trim();
    if (recName) {
      suggestedRecurring = {
        name: sanitizeText(recName.slice(0, 200)),
        amountCents: cents,
        category: parsed.categoryGuess?.trim() ? sanitizeText(parsed.categoryGuess) : null,
        frequency: parsed.frequencyGuess ?? "MONTHLY",
        anchorDay: parsed.anchorDayGuess ?? 1,
        method: (parsed.paymentMethodGuess ?? "OTHER") as FinancialTransactionMethod,
      };
    } else {
      warnings.push("Nome do gasto fixo não identificado — preencha manualmente.");
    }
  }

  // Segunda passagem: narrativa completa pode revelar PIX/crédito/Nx se a IA omitiu.
  const paymentEnrich = inferPortuguesePayment({
    text: summary ?? parsed.narrativeSummaryPt,
    methodToken: parsed.paymentMethodGuess,
    installmentToken: parsed.installmentCountGuess,
  });
  const enrichedModel: OfficeFinanceModelOutput = {
    ...parsed,
    narrativeSummaryPt: summary ?? parsed.narrativeSummaryPt,
    paymentMethodGuess: paymentEnrich.method ?? parsed.paymentMethodGuess ?? null,
    installmentCountGuess: paymentEnrich.installmentCount ?? parsed.installmentCountGuess ?? null,
    cardKindGuess: paymentEnrich.cardKind ?? parsed.cardKindGuess ?? null,
  };
  if (
    paymentEnrich.method &&
    enrichedModel.registerSalePaymentGuess == null &&
    (parsed.recordType === "patient_sale" || parsed.recordType === "standalone_transaction")
  ) {
    enrichedModel.registerSalePaymentGuess = true;
  }
  const suggestedPaymentNote = formatPaymentNotes({
    method: enrichedModel.paymentMethodGuess ?? null,
    cardKind: enrichedModel.cardKindGuess ?? null,
    installmentCount: enrichedModel.installmentCountGuess ?? null,
  });

  return {
    model: enrichedModel,
    resolvedPatientId: patientMatch?.id ?? null,
    resolvedProfessionalServiceId: resolvedServiceId,
    suggestedAgreedPriceCents:
      parsed.recordType === "patient_sale" ? cents : null,
    suggestedStandaloneAmountCents:
      parsed.recordType === "standalone_transaction" ? cents : null,
    suggestedOccurredYyyyMmDd: suggestedOccurred,
    suggestedPerformedSessionYyyyMmDd,
    suggestedSaleAction,
    suggestedInstallmentCount: enrichedModel.installmentCountGuess ?? null,
    suggestedPaymentNote,
    suggestedCatalog,
    suggestedCatalogItems,
    suggestedRecurring,
    warnings,
  };
}

export type OfficeFinanceExtractInputFile = {
  base64: string;
  mimeType: string;
  fileName?: string;
};

/**
 * Gemini multimodal: áudio falado pelo profissional e/ou imagens/PDF de comprovantes.
 */
export async function runOfficeFinanceExtraction(params: {
  audio?: { mimeType: string; base64: string } | null;
  text?: string | null;
  images: OfficeFinanceExtractInputFile[];
  patients: OfficeFinanceContextPatient[];
  services: OfficeFinanceContextService[];
  extractTarget?: OfficeFinanceExtractTarget;
}): Promise<{ ok: true; envelope: OfficeFinanceExtractionEnvelope } | { ok: false; error: string }> {
  const { audio, text, images, patients, services, extractTarget = "auto" } = params;
  const targetBlock = extractTargetPromptBlock(extractTarget);

  const patientLines = patients
    .map((p) => `- id="${p.id}" | nome="${p.name.replace(/"/g, '\\"')}"`)
    .join("\n");
  const serviceLines = services
    .map(
      (s) =>
        `- id="${s.id}" | nome="${s.name.replace(/"/g, '\\"')}" | referência ~ R$ ${(s.defaultPriceCents / 100).toFixed(2)}`,
    )
    .join("\n");

  const catalogOutputRule =
    extractTarget === "catalog"
      ? `Para catalog_service com PDF/tabela de preços: devolva array "services" com TODOS os planos/serviços visíveis (ver FOCO acima). Preencha também o primeiro item em professionalServiceGuess, agreedAmountReais e serviceDescriptionGuess. A chave "services" é OBRIGATÓRIA quando houver 2+ linhas no documento.`
      : `Para catalog_service com vários itens no PDF: devolva UM objeto com o primeiro serviço nos campos principais; liste os demais em narrativeSummaryPt (não devolva array na raiz).`;

  const promptText = `
És um assistente financeiro do laboratório de prótese dentária Louzada, no Brasil.

TAREFA: analisa o TEXTO, o ÁUDIO e/ou os FICHEIROS de imagem/PDF enviados (comprovante, recibo, nota de coleta ou entrega).

CONTEXTOS já conhecidos (usa só para desambiguar nomes; NÃO inventes ids):
Clientes do laboratório (dentistas e clínicas):
${patients.length ? patientLines : "(vazio)"}

Serviços de prótese no catálogo:
${services.length ? serviceLines : "(vazio)"}

REGRAS:
- Responde apenas com UM objecto JSON válido (sem texto fora do JSON, sem Markdown).
- O cliente é o dentista ou a clínica. Não trates nomes como paciente clínico, evolução, consulta ou prontuário.
- Coleta e entrega são o movimento da peça. O valor acompanha o trabalho (coroa, protocolo, lente, provisório, conserto).
- recordType:
  • "patient_sale" — venda de um trabalho de prótese para um cliente, na coleta ou na entrega.
  • "standalone_transaction" — receita ou despesa sem venda de catálogo (material, motoboy, combustível, frete).
  • "catalog_service" — cadastro de serviço de prótese (nome, preço, descrição).
  • "recurring_expense" — despesa fixa recorrente (aluguel, software, contador).
  • "unclear" — informação insuficiente.
- agreedAmountReais: valor em reais (ex.: 450); null se incerto. Para catalog_service = valor à vista do trabalho; para recurring_expense = valor por período.
- serviceDescriptionGuess: material, prazo ou parcelas. Não fales em sessão nem em pacote.
- recurringNameGuess, categoryGuess, frequencyGuess, anchorDayGuess: só quando recurring_expense.
- occurredDateGuess: data em dd/mm/aaaa ou yyyy-mm-dd se existir; senão null.
- purchaseTypeGuess: sempre "SINGLE". packageSessionsGuess: sempre null.
- billingModeGuess: "MONTHLY" só para mensalidade de um cliente do laboratório; "SESSION" para cada trabalho avulso.
- performedSessionDatesGuess: sempre null. performedSessionsCountGuess: sempre null.
- saleActionGuess: "new_sale" quando houver venda; null se incerto. Nunca "mark_sessions_done".
- paymentMethodGuess: forma de pagamento — use CASH | PIX | CARD | TRANSFER | OTHER.
  Sinónimos: dinheiro/espécie=CASH; pix=PIX; crédito/débito/cartão=CARD; TED/DOC/transferência=TRANSFER.
  Se o profissional disser "crédito", "cartão de crédito", "débito" ou "parcelado", use CARD (não null).
- installmentCountGuess: número de parcelas no crédito (2–48) quando disser "em 5x", "parcelado em oito vezes",
  "3 parcelas", etc. null se à vista ou não mencionado.
- cardKindGuess: "CREDIT" se crédito/parcelado; "DEBIT" se débito; null se só "cartão" sem detalhe.
- registerSalePaymentGuess: true se pagamento JÁ recebido (inclui quando cita forma de pagamento); false se só
  vinculou venda sem receber; null se incerto.

${targetBlock}

Schema EXACTO das chaves JSON (inclua TODAS as chaves; use null quando não aplicável):
recordType | patientNameGuess | professionalServiceGuess | serviceDescriptionGuess |
recurringNameGuess | categoryGuess | frequencyGuess | anchorDayGuess |
purchaseTypeGuess | packageSessionsGuess | performedSessionDatesGuess | performedSessionsCountGuess |
saleActionGuess | agreedAmountReais | transactionKindGuess |
paymentMethodGuess | installmentCountGuess | cardKindGuess | occurredDateGuess | registerSalePaymentGuess |
narrativeSummaryPt | confidenceOverall

Tipos: recordType e enums como strings exatas; agreedAmountReais e confidenceOverall como NÚMEROS (ex.: 250.5 e 0.85), nunca strings.
performedSessionDatesGuess é array de strings (datas) ou null.
saleActionGuess é "new_sale" | "mark_sessions_done" | null.
installmentCountGuess é número inteiro (2–48) ou null; cardKindGuess é "CREDIT" | "DEBIT" | null.
${catalogOutputRule}
${extractTarget === "catalog" ? 'Chave opcional extra para catálogo: "services" — array de { name, price, description, packageSessionsGuess?, billingModeGuess? }.' : ""}
`.trim();

  const parts: Part[] = [{ text: promptText }];

  if (text?.trim()) {
    parts.push({ text: `Texto informado pelo profissional:\n${sanitizeText(text).slice(0, 4000)}` });
  }

  if (audio?.base64) {
    parts.push({
      inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 },
    });
    parts.push({ text: "(áudio acima — transcreve conceitos financeiros apenas)" });
  }

  if (images.length > 0) {
    parts.push({ text: "Anexos (imagens/comprovantes) seguem para OCR:" });
    for (const img of images) {
      parts.push({
        inlineData: { mimeType: img.mimeType, data: img.base64 },
      });
    }
  }

  try {
    const sys =
      extractTarget === "catalog"
        ? `
És especializado em tabelas de preço de laboratório de prótese dentária no Brasil.
Separa nome curto do trabalho (sem R$), valor à vista numérico e parcelas na descrição.
Nunca inventas serviços, sessões ou pacientes; quando incerto, null e confidenceOverall baixo.
Respondes só JSON strict.
`.trim()
        : `
És especializado em áudio e comprovantes do caixa de um laboratório de prótese dentária.
Clientes são dentistas e clínicas. Valores acompanham coleta ou entrega da peça.
Nunca inventes clientes, pacientes ou valores; quando incerto, null e confidenceOverall baixo.
Respondes só JSON strict.
`.trim();

    const { result } = await generateContentSafeWithModelFallback(
      {
        systemInstruction: sys,
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      },
      parts,
      120_000,
    );

    const text = result.response.text();
    if (!text?.trim()) {
      return { ok: false, error: "Modelo não devolveu conteúdo." };
    }
    const json = parseModelJson(text);
    if (json === null) {
      return { ok: false, error: "O modelo não devolveu JSON válido." };
    }
    const normalized = normalizeOfficeFinanceModelJson(json, extractTarget);
    const parsedOuter = officeFinanceModelOutputSchema.safeParse(normalized);
    if (!parsedOuter.success) {
      logger.warn("office-finance extract: validação Zod falhou", {
        issues: parsedOuter.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
        extractTarget,
      });
      return { ok: false, error: "Resposta da IA não pôde ser validada." };
    }
    const catalogItems =
      extractTarget === "catalog" || parsedOuter.data.recordType === "catalog_service"
        ? extractCatalogItemsFromJson(json)
        : [];
    const envelope = envelopeFromModelOutput(
      parsedOuter.data,
      patients,
      services,
      catalogItems,
    );
    // Texto cru do profissional (além da narrativa da IA) — reforça PIX/crédito/Nx.
    const sourceText = params.text?.trim() ?? "";
    if (sourceText) {
      const fromSource = inferPortuguesePayment({
        text: `${sourceText}\n${envelope.model.narrativeSummaryPt ?? ""}`,
        methodToken: envelope.model.paymentMethodGuess,
        installmentToken: envelope.model.installmentCountGuess,
      });
      if (fromSource.method || fromSource.installmentCount) {
        const model = {
          ...envelope.model,
          paymentMethodGuess: fromSource.method ?? envelope.model.paymentMethodGuess,
          installmentCountGuess:
            fromSource.installmentCount ?? envelope.model.installmentCountGuess,
          cardKindGuess: fromSource.cardKind ?? envelope.model.cardKindGuess,
        };
        if (
          fromSource.method &&
          model.registerSalePaymentGuess == null &&
          (model.recordType === "patient_sale" || model.recordType === "standalone_transaction")
        ) {
          model.registerSalePaymentGuess = true;
        }
        return {
          ok: true,
          envelope: {
            ...envelope,
            model,
            suggestedInstallmentCount: model.installmentCountGuess ?? null,
            suggestedPaymentNote: formatPaymentNotes({
              method: model.paymentMethodGuess ?? null,
              cardKind: model.cardKindGuess ?? null,
              installmentCount: model.installmentCountGuess ?? null,
            }),
          },
        };
      }
    }
    return { ok: true, envelope };
  } catch (e) {
    return { ok: false, error: formatAiProviderErrorForUser(e) };
  }
}
