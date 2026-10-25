/** WhatsApp do fundador para suporte prioritário PRO (somente dígitos, formato wa.me). */
export const PRO_PRIORITY_SUPPORT_WHATSAPP_E164 = "5516992756619";

/** SLA exibido no produto para assinantes PRO. */
export const PRO_PRIORITY_SUPPORT_SLA_LABEL = "até 24 horas úteis";

export function buildProSupportWhatsAppUrl(prefill: {
  userName?: string | null;
  userEmail?: string | null;
}): string {
  const lines = [
    "Olá! Sou assinante PRO do Louzada Entregas e preciso de suporte prioritário.",
    prefill.userEmail ? `E-mail cadastrado: ${prefill.userEmail}` : null,
    prefill.userName ? `Nome: ${prefill.userName}` : null,
    "",
    "Mensagem:",
  ].filter((line): line is string => Boolean(line));

  return `https://wa.me/${PRO_PRIORITY_SUPPORT_WHATSAPP_E164}?text=${encodeURIComponent(lines.join("\n"))}`;
}
