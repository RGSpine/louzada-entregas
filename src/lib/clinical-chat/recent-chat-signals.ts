import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  RECOMMENDATIONS_MAX_USER_SNIPPETS,
  RECOMMENDATIONS_RECENT_SESSIONS,
} from "@/lib/clinical-chat/constants";

export type RecentChatSignal = {
  snippet: string;
  askedAt: Date;
};

export type RecentChatSignalsSnapshot = {
  sessionsAnalyzed: number;
  signals: RecentChatSignal[];
};

const ADMIN_PATTERNS =
  /\b(agenda|financeiro|pagamento|pix|sessões?\s+pendentes?|marcação|consulta\s+agendada)\b/i;

function anonymizeSnippet(raw: string): string {
  let text = sanitizeText(raw).replace(/\s+/g, " ").trim();
  text = text.replace(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)+\b/g, "[paciente]");
  text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]");
  text = text.replace(/\b\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g, "[telefone]");
  return text.slice(0, 280);
}

function isClinicalSnippet(text: string): boolean {
  if (text.length < 12) return false;
  if (ADMIN_PATTERNS.test(text) && text.length < 80) return false;
  return true;
}

/** Últimas sessões de chat do profissional — só perguntas do user, sem PII. */
export async function getRecentChatSignals(
  userId: string,
): Promise<RecentChatSignalsSnapshot> {
  const sessions = await prisma.patientChatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: RECOMMENDATIONS_RECENT_SESSIONS,
    select: {
      id: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { content: true, createdAt: true },
      },
    },
  });

  const signals: RecentChatSignal[] = [];

  for (const session of sessions) {
    for (const message of session.messages) {
      const snippet = anonymizeSnippet(message.content);
      if (!isClinicalSnippet(snippet)) continue;
      signals.push({ snippet, askedAt: message.createdAt });
      if (signals.length >= RECOMMENDATIONS_MAX_USER_SNIPPETS) break;
    }
    if (signals.length >= RECOMMENDATIONS_MAX_USER_SNIPPETS) break;
  }

  return {
    sessionsAnalyzed: sessions.length,
    signals,
  };
}
