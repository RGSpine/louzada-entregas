import type { FinancialTransactionMethod } from "@prisma/client";

export function formatBrlFromCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}

/** "1.234,56" ou "200" → centavos; null se inválido. */
export function rawMoneyToCents(raw: string): number | null {
  const trimmed = raw.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!trimmed || trimmed === "-") return null;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function centsToRawInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function todayInput(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const METHOD_PT: Record<FinancialTransactionMethod, string> = {
  CASH: "Dinheiro",
  PIX: "PIX",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};
