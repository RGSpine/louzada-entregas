/** Monta o link de ligação. Número local com DDD ganha o prefixo do Brasil. */
export function phoneCallHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("55") && digits.length >= 12) return `tel:+${digits}`;
  if (digits.length >= 10) return `tel:+55${digits}`;
  return `tel:${digits}`;
}
