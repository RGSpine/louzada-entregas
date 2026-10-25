"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sanitizeText } from "@/lib/sanitize";
import { buildPlatformCustomizationWhatsAppUrl } from "@/lib/platform-customization-whatsapp";

const LeadSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("E-mail inválido.").max(200),
  phone: z
    .string()
    .trim()
    .min(10, "Informe um WhatsApp válido.")
    .max(20)
    .regex(/^[\d\s()+-]+$/, "Telefone inválido."),
  profileType: z.enum(["solo", "clinica"], {
    error: "Selecione clínico solo ou clínica.",
  }),
  description: z
    .string()
    .trim()
    .min(20, "Descreva com pelo menos 20 caracteres o que você precisa.")
    .max(4000),
  source: z.enum(["public", "dashboard"]),
});

export type SubmitPlatformCustomizationLeadResult =
  | { success: true; whatsappUrl: string }
  | { success: false; error: string };

const PROFILE_LABELS = {
  solo: "Clínico solo",
  clinica: "Clínica / equipe",
} as const;

export async function submitPlatformCustomizationLead(
  raw: z.infer<typeof LeadSchema>,
): Promise<SubmitPlatformCustomizationLeadResult> {
  const parsed = LeadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const data = parsed.data;
  const emailKey = data.email.toLowerCase();

  const rl = await enforceRateLimit(`platform-lead:${emailKey}`, {
    maxRequests: 5,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return {
      success: false,
      error: `Muitas tentativas. Aguarde ${rl.resetIn}s e tente novamente.`,
    };
  }

  if (data.source === "dashboard") {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error,
    } = await supabase.auth.getUser();
    if (error || !authUser) {
      return { success: false, error: "Faça login para enviar pelo painel." };
    }
  }

  const whatsappUrl = buildPlatformCustomizationWhatsAppUrl({
    name: sanitizeText(data.name),
    email: data.email,
    phone: data.phone.trim(),
    profileLabel: PROFILE_LABELS[data.profileType],
    description: sanitizeText(data.description),
  });

  return { success: true, whatsappUrl };
}
