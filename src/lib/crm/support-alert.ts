import { prisma } from "@/lib/prisma";
import { ensureCrmProfile, syncCrmAccount } from "@/lib/crm/sync-account";

/** Cria alerta CRM quando usuário reporta bug ou reclamação no suporte. */
export async function createCrmSupportAlert(input: {
  userId: string;
  category: string;
  subject: string;
  message: string;
}) {
  if (input.category !== "bug" && input.category !== "reclamacao") {
    return;
  }

  const profile = await ensureCrmProfile(input.userId);
  const alertType =
    input.category === "bug" ? "SUPPORT_BUG_REPORT" : "SUPPORT_COMPLAINT";

  const existing = await prisma.crmAlert.findFirst({
    where: {
      profileId: profile.id,
      alertType,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  if (existing) return;

  await prisma.crmAlert.create({
    data: {
      profileId: profile.id,
      userId: input.userId,
      alertType,
      severity: input.category === "reclamacao" ? "HIGH" : "MEDIUM",
      title:
        input.category === "bug"
          ? "Bug reportado no suporte"
          : "Reclamação no suporte",
      message: `${input.subject}: ${input.message.slice(0, 500)}`,
      suggestedChannel: "WHATSAPP",
      suggestedMessage:
        input.category === "bug"
          ? "Olá! Recebemos seu reporte de problema. Pode nos contar em qual tela isso aconteceu e se consegue reproduzir?"
          : "Olá! Vimos sua mensagem no suporte e queremos resolver isso com você. Tem 2 minutos para conversarmos?",
      metadata: { category: input.category, subject: input.subject },
    },
  });

  void syncCrmAccount(input.userId).catch(() => undefined);
}
