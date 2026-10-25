import { prisma } from "@/lib/prisma";
import {
  CHAT_RETENTION_MONTHS,
  CHAT_STORED_MESSAGES_MAX,
} from "@/lib/clinical-chat/constants";

function retentionCutoffDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - CHAT_RETENTION_MONTHS);
  return d;
}

/**
 * Aplica política de retenção: idade máxima + teto de mensagens por thread.
 * Chamado após cada par user/assistant salvo.
 */
export async function pruneClinicalChatMessages(sessionId: string): Promise<void> {
  const cutoff = retentionCutoffDate();

  await prisma.patientChatMessage.deleteMany({
    where: {
      sessionId,
      createdAt: { lt: cutoff },
    },
  });

  const overflow = await prisma.patientChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    skip: CHAT_STORED_MESSAGES_MAX,
  });

  if (overflow.length > 0) {
    await prisma.patientChatMessage.deleteMany({
      where: { id: { in: overflow.map((m) => m.id) } },
    });
  }
}
