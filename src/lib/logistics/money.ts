import {
  inferPortuguesePayment,
  type PortuguesePaymentGuess,
} from "@/lib/finance/portuguese-payment";

export type LogisticsPaymentMethod = "CASH" | "PIX" | "CARD" | "TRANSFER" | "OTHER";

const ONES: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
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
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

const TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function brlToCents(intPart: string, decimals?: string): number | null {
  const reais = Number(intPart.replace(/\./g, ""));
  if (!Number.isFinite(reais) || reais < 0 || reais > 1_000_000) return null;
  const cents = decimals ? Number(decimals.padEnd(2, "0").slice(0, 2)) : 0;
  if (!Number.isFinite(cents)) return null;
  return reais * 100 + cents;
}

function spokenReais(phrase: string): number | null {
  const tokens = fold(phrase)
    .split(/\s+/)
    .filter((token) => token && token !== "e" && token !== "de");
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (token === "mil") {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    if (HUNDREDS[token] != null) {
      current += HUNDREDS[token];
      continue;
    }
    if (TENS[token] != null) {
      current += TENS[token];
      continue;
    }
    if (ONES[token] != null) {
      current += ONES[token];
      continue;
    }
    return null;
  }
  total += current;
  return total > 0 ? total * 100 : null;
}

const NUMBER = String.raw`(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?`;

/** Valor citado no áudio, em centavos. Silêncio devolve null. Não inventa preço. */
export function hearAmountCents(text: string): number | null {
  const norm = fold(text);
  if (!norm) return null;

  const currency = norm.match(new RegExp(String.raw`r\$\s*${NUMBER}`));
  if (currency?.[1]) return brlToCents(currency[1], currency[2]);

  const reais = norm.match(new RegExp(String.raw`${NUMBER}\s*reais?\b`));
  if (reais?.[1]) return brlToCents(reais[1], reais[2]);

  const spoken = norm.match(/\b([a-z]+(?:\s+(?:e\s+)?[a-z]+){0,6})\s+reais?\b/);
  if (spoken?.[1]) {
    const cents = spokenReais(spoken[1]);
    if (cents != null) return cents;
  }

  const charged = norm.match(
    new RegExp(String.raw`\b(?:pago|paga|pagou|recebi|recebido|cobrei|cobrado|valor)\s+(?:de\s+)?${NUMBER}\b`),
  );
  if (charged?.[1]) return brlToCents(charged[1], charged[2]);

  return null;
}

export function hearLogisticsMoney(text: string): {
  amountCents: number | null;
  paymentMethod: LogisticsPaymentMethod | null;
} {
  const payment: PortuguesePaymentGuess = inferPortuguesePayment({ text });
  return {
    amountCents: hearAmountCents(text),
    paymentMethod: payment.method,
  };
}

/** Campo livre da revisão, em reais. Vazio volta null. */
export function brlInputToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = fold(trimmed).match(new RegExp(String.raw`^${NUMBER}$`));
  if (!match?.[1]) return null;
  return brlToCents(match[1], match[2]);
}

export function centsToBrlInput(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
