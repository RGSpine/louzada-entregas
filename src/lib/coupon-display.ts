/** Extrai % de desconto do sufixo numérico do cupom (ex.: RGFISIO20 → 20). */
export function parseCouponPercentFromCode(code: string): number | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const match = normalized.match(/(\d{1,3})$/);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return percent;
}

/** Converte string pt-BR "49,90" em centavos inteiros. */
export function parseBrlPriceToCents(price: string): number {
  const normalized = price.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

/** Formata centavos para exibição pt-BR sem símbolo (ex.: 3990 → "39,90"). */
export function formatBrlCentsForDisplay(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function applyPercentDiscountCents(originalCents: number, percent: number): number {
  if (percent <= 0) return originalCents;
  if (percent >= 100) return 0;
  return Math.round(originalCents * (1 - percent / 100));
}

export type CouponPricePreview = {
  original: string;
  discounted: string;
  percent: number;
};

export function buildCouponPricePreview(
  originalPriceLabel: string,
  percent: number,
): CouponPricePreview {
  const originalCents = parseBrlPriceToCents(originalPriceLabel);
  const discountedCents = applyPercentDiscountCents(originalCents, percent);
  return {
    original: originalPriceLabel,
    discounted: formatBrlCentsForDisplay(discountedCents),
    percent,
  };
}
