/**
 * Outreach CRM via wa.me — abre o WhatsApp do founder (sessão do aparelho)
 * já na conversa com o profissional, com texto pré-preenchido.
 */

/** Só dígitos. */
export function digitsOnlyPhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * Normaliza telefone BR para wa.me (E.164 sem +).
 * Exemplos: (16) 99275-6619 → 5516992756619; 16992756619 → 5516992756619.
 */
export function normalizeBrazilWhatsAppDigits(
  raw: string | null | undefined,
): string | null {
  let d = digitsOnlyPhone(raw);
  if (!d) return null;

  // Remove zero inicial de DDD antigo (016…)
  if (d.startsWith("0") && d.length >= 11) {
    d = d.slice(1);
  }

  if (d.startsWith("55") && d.length >= 12 && d.length <= 13) {
    return d;
  }

  // Celular com DDD: 10 ou 11 dígitos (com 9)
  if (d.length === 10 || d.length === 11) {
    return `55${d}`;
  }

  // Já veio com 55 truncado demais ou inválido
  if (d.length >= 12 && d.length <= 13) {
    return d.startsWith("55") ? d : `55${d}`;
  }

  return null;
}

export function buildCrmWhatsAppOutreachUrl(input: {
  phone: string | null | undefined;
  text: string;
}): { ok: true; url: string; digits: string } | { ok: false; reason: string } {
  const digits = normalizeBrazilWhatsAppDigits(input.phone);
  if (!digits) {
    return {
      ok: false,
      reason: "Telefone inválido ou ausente. Cadastre o WhatsApp na ficha do profissional.",
    };
  }
  const text = input.text.trim();
  if (!text) {
    return { ok: false, reason: "Mensagem vazia." };
  }
  return {
    ok: true,
    digits,
    url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
  };
}

export function defaultCrmOutreachMessage(input: {
  name?: string | null;
  planLabel?: string | null;
}): string {
  const name = input.name?.trim() || "olá";
  const plan = input.planLabel?.trim();
  return [
    `Oi, ${name}! Aqui é o Roberto, do Louzada Entregas.`,
    plan
      ? `Vi sua conta (${plan}) e queria entender como está sendo o uso na prática.`
      : "Vi sua conta e queria entender como está sendo o uso na prática.",
    "Tem 2 minutinhos para conversarmos?",
  ].join(" ");
}
