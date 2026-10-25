/**
 * Parcelamento no crédito: sem juros (valor do catálogo) ou com juros (% flat).
 * Toda aritmética de centavos vive aqui — a IA nunca calcula dinheiro.
 */

import { splitCentsAcrossParts } from "@/lib/finance/split-cents";

export type CardInterestMode = "none" | "with";

function formatBrlFromCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}

export type CardInstallmentBreakdown = {
  baseAmountCents: number;
  totalCents: number;
  interestCents: number;
  interestPercent: number;
  withInterest: boolean;
  installmentCount: number;
  installmentCents: number[];
};

/** "5", "2,5", "10.5" → percentual; null se inválido. */
export function parseInterestPercent(raw: string): number | null {
  const trimmed = raw.replace(/\s/g, "").replace(/%/g, "");
  if (!trimmed || trimmed === "-" || trimmed === ",") return null;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  // Duas casas (ex.: 2,99%).
  return Math.round(num * 100) / 100;
}

/** Aplica juros flat sobre o total do catálogo: total = base × (1 + p/100). */
export function applyFlatInterestCents(
  baseAmountCents: number,
  interestPercent: number,
): number {
  if (!Number.isInteger(baseAmountCents) || baseAmountCents < 0) {
    throw new Error("baseAmountCents inválido");
  }
  if (!Number.isFinite(interestPercent) || interestPercent < 0 || interestPercent > 100) {
    throw new Error("interestPercent inválido");
  }
  if (interestPercent === 0) return baseAmountCents;
  return Math.round(baseAmountCents * (1 + interestPercent / 100));
}

/**
 * Pagamento de compra: pode ser o valor acordado (catálogo) ou até +100% flat
 * (juros no crédito). Abaixo do acordado = rejeitado (sem desconto silencioso).
 */
export function isPurchasePaymentAmountAllowed(
  agreedPriceCents: number,
  paidCents: number,
): boolean {
  if (!Number.isInteger(agreedPriceCents) || agreedPriceCents < 0) return false;
  if (!Number.isInteger(paidCents) || paidCents < 1) return false;
  if (paidCents < agreedPriceCents) return false;
  return paidCents <= applyFlatInterestCents(agreedPriceCents, 100);
}

/**
 * Calcula total e fatias das parcelas.
 * Sem juros: total = catálogo. Com juros: total = catálogo + %.
 */
export function computeCardInstallmentBreakdown(params: {
  baseAmountCents: number;
  installmentCount: number;
  withInterest: boolean;
  interestPercent: number;
}): CardInstallmentBreakdown {
  const { baseAmountCents, installmentCount, withInterest } = params;
  if (!Number.isInteger(baseAmountCents) || baseAmountCents < 0) {
    throw new Error("baseAmountCents inválido");
  }
  if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 48) {
    throw new Error("installmentCount inválido (2–48)");
  }

  const interestPercent =
    withInterest && Number.isFinite(params.interestPercent) && params.interestPercent > 0
      ? Math.round(params.interestPercent * 100) / 100
      : 0;
  const applyInterest = withInterest && interestPercent > 0;
  const totalCents = applyInterest
    ? applyFlatInterestCents(baseAmountCents, interestPercent)
    : baseAmountCents;
  const installmentCents = splitCentsAcrossParts(totalCents, installmentCount);

  return {
    baseAmountCents,
    totalCents,
    interestCents: totalCents - baseAmountCents,
    interestPercent: applyInterest ? interestPercent : 0,
    withInterest: applyInterest,
    installmentCount,
    installmentCents,
  };
}

/** Texto curto para notas/descrição do lançamento. */
export function formatCardInstallmentNotes(params: {
  installmentCount: number;
  withInterest: boolean;
  interestPercent?: number | null;
}): string {
  const n = params.installmentCount;
  if (!Number.isInteger(n) || n < 2) {
    return "Cartão de crédito";
  }
  if (params.withInterest && params.interestPercent != null && params.interestPercent > 0) {
    const pct = String(params.interestPercent).replace(".", ",");
    return `Cartão de crédito em ${n}x com ${pct}% de juros`;
  }
  return `Cartão de crédito em ${n}x sem juros`;
}

/** Preview legível para a UI de confirmação. */
export function formatCardInstallmentPreview(plan: CardInstallmentBreakdown): string {
  const typical = plan.installmentCents[0] ?? 0;
  const allEqual = plan.installmentCents.every((c) => c === typical);
  const parcelLabel = allEqual
    ? `${plan.installmentCount}× de ${formatBrlFromCents(typical)}`
    : `${plan.installmentCount} parcelas (ex.: ${formatBrlFromCents(typical)} na 1ª)`;

  if (plan.withInterest && plan.interestPercent > 0) {
    const pct = String(plan.interestPercent).replace(".", ",");
    return `${parcelLabel} · total ${formatBrlFromCents(plan.totalCents)} (catálogo ${formatBrlFromCents(plan.baseAmountCents)} + ${pct}% juros)`;
  }
  return `${parcelLabel} · total ${formatBrlFromCents(plan.totalCents)} sem juros`;
}

/**
 * Resolve breakdown a partir de inputs de formulário.
 * Retorna null se parcelas inválidas ou (com juros) % inválido.
 */
export function resolveCardInstallmentFromForm(params: {
  baseAmountCents: number;
  installmentCountRaw: string;
  interestMode: CardInterestMode;
  interestPercentRaw: string;
}):
  | { ok: true; plan: CardInstallmentBreakdown; notes: string }
  | { ok: false; error: string }
  | { ok: true; plan: null; notes: null } {
  const n = Number(params.installmentCountRaw);
  if (!params.installmentCountRaw.trim() || !Number.isFinite(n) || n < 2) {
    return { ok: true, plan: null, notes: null };
  }
  if (!Number.isInteger(n) || n > 48) {
    return { ok: false, error: "Parcelas no crédito: informe um número entre 2 e 48." };
  }

  const withInterest = params.interestMode === "with";
  let interestPercent = 0;
  if (withInterest) {
    const parsed = parseInterestPercent(params.interestPercentRaw);
    if (parsed == null || parsed <= 0) {
      return {
        ok: false,
        error: "Informe a porcentagem de juros (maior que zero), ou escolha sem juros.",
      };
    }
    interestPercent = parsed;
  }

  try {
    const plan = computeCardInstallmentBreakdown({
      baseAmountCents: params.baseAmountCents,
      installmentCount: n,
      withInterest,
      interestPercent,
    });
    return {
      ok: true,
      plan,
      notes: formatCardInstallmentNotes({
        installmentCount: n,
        withInterest: plan.withInterest,
        interestPercent: plan.interestPercent,
      }),
    };
  } catch {
    return { ok: false, error: "Não foi possível calcular as parcelas." };
  }
}
