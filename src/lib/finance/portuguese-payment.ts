/**
 * Reconhecimento determinístico de forma de pagamento e parcelas em português.
 * Complementa a IA (Gemini/DeepSeek) — nunca faz aritmética de valores.
 */

import type { FinancialTransactionMethod } from "@prisma/client";

export type PortugueseCardKind = "CREDIT" | "DEBIT";

export type PortuguesePaymentGuess = {
  method: FinancialTransactionMethod | null;
  /** Crédito vs débito quando o texto distingue; null se só "cartão". */
  cardKind: PortugueseCardKind | null;
  /** Nº de parcelas (2–48); null se à vista / não mencionado. */
  installmentCount: number | null;
};

const METHOD_ALIASES: Record<string, FinancialTransactionMethod> = {
  cash: "CASH",
  dinheiro: "CASH",
  specie: "CASH",
  especie: "CASH",
  pix: "PIX",
  card: "CARD",
  cartao: "CARD",
  credito: "CARD",
  debito: "CARD",
  transfer: "TRANSFER",
  transferencia: "TRANSFER",
  ted: "TRANSFER",
  doc: "TRANSFER",
  other: "OTHER",
  outro: "OTHER",
};

function normalizePt(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_NUMBERS: Record<string, number> = {
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

function parseInstallmentToken(raw: string): number | null {
  const t = normalizePt(raw);
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 2 && n <= 48 ? n : null;
  }
  return WORD_NUMBERS[t] ?? null;
}

/**
 * Extrai quantidade de parcelas de frases como:
 * "em 5x", "parcelado em oito vezes", "crédito em 3 parcelas", "5 vezes no cartão".
 */
export function extractInstallmentCount(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const norm = normalizePt(text);

  const patterns: RegExp[] = [
    /\b(?:em|de|no|na)\s+(\d{1,2})\s*x\b/,
    /\b(\d{1,2})\s*x\b/,
    /\bparcelad[oa]s?\s+(?:em\s+)?(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s*(?:x|vezes|parcelas?)?\b/,
    /\bem\s+(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s*(?:x|vezes|parcelas?)\b/,
    /\b(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(?:vezes|parcelas?)\b/,
    /\b(?:credito|cartao(?:\s+de\s+credito)?)\s+(?:em\s+)?(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s*(?:x|vezes|parcelas?)?\b/,
  ];

  for (const re of patterns) {
    const m = re.exec(norm);
    if (!m?.[1]) continue;
    const n = parseInstallmentToken(m[1]);
    if (n != null) return n;
  }
  return null;
}

/**
 * Normaliza valor solto da IA ("crédito", "Cartão de débito", "PIX") para o enum.
 */
export function normalizePaymentMethodToken(
  value: unknown,
): FinancialTransactionMethod | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const key = normalizePt(value).replace(/\s+/g, "_");

  if (METHOD_ALIASES[key]) return METHOD_ALIASES[key]!;
  if ((["CASH", "PIX", "CARD", "TRANSFER", "OTHER"] as const).includes(key.toUpperCase() as FinancialTransactionMethod)) {
    return key.toUpperCase() as FinancialTransactionMethod;
  }

  if (
    /cartao_de_credito|cartao_credito|no_credito|credito|credit/.test(key) ||
    key.includes("credito")
  ) {
    return "CARD";
  }
  if (
    /cartao_de_debito|cartao_debito|no_debito|debito|debit/.test(key) ||
    key.includes("debito")
  ) {
    return "CARD";
  }
  if (key.includes("cartao") || key.includes("card")) return "CARD";
  if (key.includes("dinheiro") || key.includes("especie") || key === "cash") return "CASH";
  if (key.includes("pix")) return "PIX";
  if (key.includes("transfer") || key.includes("ted") || key === "doc") return "TRANSFER";

  return null;
}

export function extractCardKind(text: string | null | undefined): PortugueseCardKind | null {
  if (!text?.trim()) return null;
  const norm = normalizePt(text);
  const hasCredit =
    /\bcredito\b/.test(norm) || /\bcartao\s+de\s+credito\b/.test(norm) || /\bno\s+credito\b/.test(norm);
  const hasDebit =
    /\bdebito\b/.test(norm) || /\bcartao\s+de\s+debito\b/.test(norm) || /\bno\s+debito\b/.test(norm);
  if (hasCredit && !hasDebit) return "CREDIT";
  if (hasDebit && !hasCredit) return "DEBIT";
  if (hasCredit) return "CREDIT";
  return null;
}

/**
 * Inferência completa a partir do texto (transcrição/narrativa) e/ou token da IA.
 */
export function inferPortuguesePayment(params: {
  text?: string | null;
  methodToken?: unknown;
  installmentToken?: unknown;
}): PortuguesePaymentGuess {
  const fromToken = normalizePaymentMethodToken(params.methodToken);
  const fromTextMethod = (() => {
    const t = params.text;
    if (!t?.trim()) return null;
    const norm = normalizePt(t);
    if (/\bpix\b/.test(norm)) return "PIX" as const;
    if (/\bdinheiro\b|\bem\s+especie\b|\bespecie\b/.test(norm)) return "CASH" as const;
    if (/\btransferencia\b|\bted\b|\bdoc\b/.test(norm)) return "TRANSFER" as const;
    if (
      /\bcredito\b|\bdebito\b|\bcartao\b|\bparcelad/.test(norm) ||
      /\b\d{1,2}\s*x\b/.test(norm)
    ) {
      return "CARD" as const;
    }
    return null;
  })();

  const method = fromToken ?? fromTextMethod;

  let installmentCount: number | null = null;
  if (typeof params.installmentToken === "number" && Number.isFinite(params.installmentToken)) {
    const n = Math.round(params.installmentToken);
    if (n >= 2 && n <= 48) installmentCount = n;
  } else if (typeof params.installmentToken === "string") {
    installmentCount =
      parseInstallmentToken(params.installmentToken) ??
      extractInstallmentCount(params.installmentToken);
  }
  if (installmentCount == null) {
    installmentCount = extractInstallmentCount(params.text);
  }

  let cardKind = extractCardKind(
    [typeof params.methodToken === "string" ? params.methodToken : "", params.text ?? ""].join(
      " ",
    ),
  );
  if (installmentCount != null && installmentCount >= 2) {
    cardKind = cardKind ?? "CREDIT";
  }

  return {
    method: method ?? (installmentCount != null ? "CARD" : null),
    cardKind,
    installmentCount,
  };
}

/** Texto curto para notas/descrição do lançamento. */
export function formatPaymentNotes(guess: PortuguesePaymentGuess): string | null {
  if (!guess.method) return null;
  if (guess.method === "CARD") {
    if (guess.installmentCount != null && guess.installmentCount >= 2) {
      return `Cartão de crédito em ${guess.installmentCount}x`;
    }
    if (guess.cardKind === "CREDIT") return "Cartão de crédito";
    if (guess.cardKind === "DEBIT") return "Cartão de débito";
    return "Cartão";
  }
  const labels: Record<FinancialTransactionMethod, string> = {
    CASH: "Dinheiro",
    PIX: "PIX",
    CARD: "Cartão",
    TRANSFER: "Transferência",
    OTHER: "Outro",
  };
  return labels[guess.method];
}

/**
 * Meio-dia civil em America/Sao_Paulo a partir de yyyy-mm-dd.
 * Evita deslocar o dia ao serializar Date no Server Action (Vercel UTC).
 */
export function yyyyMmDdToSaoPauloNoon(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const iso = `${ymd}T12:00:00-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Data de atendimento (dd/MM/aaaa ou yyyy-MM-dd) → meio-dia civil em SP.
 * Usado na evolução e na baixa automática de sessão (Serviços/Fiscal).
 */
export function attendanceDateToSaoPauloNoon(raw?: string | null): Date | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();

  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    if (
      !Number.isFinite(day) ||
      !Number.isFinite(month) ||
      !Number.isFinite(year) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return yyyyMmDdToSaoPauloNoon(ymd);
  }

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (
      !Number.isFinite(day) ||
      !Number.isFinite(month) ||
      !Number.isFinite(year) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return yyyyMmDdToSaoPauloNoon(ymd);
  }

  return null;
}
