import { PRO_PRIORITY_SUPPORT_WHATSAPP_E164 } from "@/lib/pro-priority-support";

export function buildPlatformCustomizationWhatsAppUrl(input: {
  name: string;
  email: string;
  phone: string;
  profileLabel: string;
  description: string;
}): string {
  const lines = [
    "Olá! Tenho interesse em uma plataforma personalizada do Louzada Entregas.",
    "",
    `Nome: ${input.name}`,
    `E-mail: ${input.email}`,
    `Meu WhatsApp: ${input.phone}`,
    `Perfil: ${input.profileLabel}`,
    "",
    "O que gostaria de modificar / implementar:",
    input.description,
  ];

  return `https://wa.me/${PRO_PRIORITY_SUPPORT_WHATSAPP_E164}?text=${encodeURIComponent(lines.join("\n"))}`;
}
