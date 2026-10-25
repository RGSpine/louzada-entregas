/**
 * Contexto de Agenda e Financeiro para o chat — só carregado quando gatilhado por termos do profissional.
 */
import {
  AppointmentConfirmationStatus,
  AppointmentStatus,
  FinancialTransactionKind,
  PatientServiceSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { formatVisitKindLabel } from "@/lib/appointment-visit-meta";
import type { FinancialTransactionMethod } from "@prisma/client";

const METHOD_PT: Record<FinancialTransactionMethod, string> = {
  CASH: "Dinheiro",
  PIX: "PIX",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};

const MAX_UPCOMING = 5;
const MAX_RECENT_PAST = 8;
const MAX_PURCHASES = 6;
const MAX_INCOME_TX = 8;
const BLOCK_CHAR_LIMIT = 6000;

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusPt(status: AppointmentStatus): string {
  if (status === AppointmentStatus.COMPLETED) return "Realizada";
  if (status === AppointmentStatus.CANCELLED) return "Cancelada";
  if (status === AppointmentStatus.NO_SHOW) return "Faltou";
  return "Agendada";
}

function confirmationPt(s: AppointmentConfirmationStatus): string {
  if (s === AppointmentConfirmationStatus.CONFIRMED) return "Presença confirmada";
  return "Confirmação pendente";
}

function truncateBlock(text: string): string {
  if (text.length <= BLOCK_CHAR_LIMIT) return text;
  return `${text.slice(0, BLOCK_CHAR_LIMIT - 40)}\n… (lista truncada)`;
}

export type AgendaFinanceContextBlocks = {
  agendaBlock: string | null;
  financeBlock: string | null;
};

export async function buildAgendaFinanceContextForChat(
  patientId: string,
  userId: string,
  wants: { agenda: boolean; finance: boolean },
): Promise<AgendaFinanceContextBlocks> {
  const [agendaBlock, financeBlock] = await Promise.all([
    wants.agenda ? buildAgendaBlock(patientId, userId) : Promise.resolve(null),
    wants.finance ? buildFinanceBlock(patientId, userId) : Promise.resolve(null),
  ]);
  return { agendaBlock, financeBlock };
}

async function buildAgendaBlock(patientId: string, userId: string): Promise<string | null> {
  const now = new Date();
  const [upcoming, recentPast] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        patientId,
        professionalUserId: userId,
        status: AppointmentStatus.SCHEDULED,
        startAt: { gte: now },
      },
      orderBy: { startAt: "asc" },
      take: MAX_UPCOMING,
      select: {
        startAt: true,
        endAt: true,
        status: true,
        confirmationStatus: true,
        visitKind: true,
        priceCents: true,
        title: true,
        professionalService: { select: { name: true } },
        evolution: { select: { id: true } },
      },
    }),
    prisma.appointment.findMany({
      where: {
        patientId,
        professionalUserId: userId,
        startAt: { lt: now },
      },
      orderBy: { startAt: "desc" },
      take: MAX_RECENT_PAST,
      select: {
        startAt: true,
        status: true,
        confirmationStatus: true,
        visitKind: true,
        priceCents: true,
        title: true,
        professionalService: { select: { name: true } },
        evolution: { select: { id: true } },
      },
    }),
  ]);

  if (upcoming.length === 0 && recentPast.length === 0) {
    return "(Nenhuma marcação registrada na agenda para este paciente.)";
  }

  const lines: string[] = ["AGENDA DO PACIENTE (dados do consultório — use só para responder à pergunta atual):"];

  if (upcoming.length > 0) {
    lines.push("\nPróximas marcações:");
    for (const a of upcoming) {
      const when = a.startAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      const svc = a.professionalService?.name || a.title || formatVisitKindLabel(a.visitKind);
      const price = a.priceCents != null ? ` · R$ ${formatBrl(a.priceCents)}` : "";
      lines.push(
        `- ${when} · ${svc} · ${statusPt(a.status)} · ${confirmationPt(a.confirmationStatus)}${price}`,
      );
    }
  } else {
    lines.push("\nPróximas marcações: nenhuma agendada.");
  }

  if (recentPast.length > 0) {
    lines.push("\nMarcações recentes (passado):");
    for (const a of recentPast) {
      const when = a.startAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      const svc = a.professionalService?.name || a.title || formatVisitKindLabel(a.visitKind);
      const evo = a.evolution ? " · com evolução" : " · sem evolução";
      const price = a.priceCents != null ? ` · R$ ${formatBrl(a.priceCents)}` : "";
      lines.push(
        `- ${when} · ${svc} · ${statusPt(a.status)} · ${confirmationPt(a.confirmationStatus)}${evo}${price}`,
      );
    }
  }

  const completedCount = recentPast.filter((a) => a.status === AppointmentStatus.COMPLETED).length;
  const cancelledCount = recentPast.filter((a) => a.status === AppointmentStatus.CANCELLED).length;
  lines.push(
    `\nResumo (amostra recente): ${completedCount} realizada(s), ${cancelledCount} cancelada(s) entre as ${recentPast.length} últimas.`,
  );

  return truncateBlock(lines.join("\n"));
}

async function buildFinanceBlock(patientId: string, userId: string): Promise<string | null> {
  const [purchases, incomeTx, pendingSessions] = await Promise.all([
    prisma.patientServicePurchase.findMany({
      where: { patientId, professionalUserId: userId },
      orderBy: { purchasedAt: "desc" },
      take: MAX_PURCHASES,
      select: {
        purchasedAt: true,
        type: true,
        sessionCountTotal: true,
        agreedPriceCents: true,
        service: { select: { name: true } },
        sessions: {
          select: { status: true },
        },
      },
    }),
    prisma.financialTransaction.findMany({
      where: {
        patientId,
        professionalUserId: userId,
        kind: FinancialTransactionKind.INCOME,
      },
      orderBy: { occurredAt: "desc" },
      take: MAX_INCOME_TX,
      select: {
        occurredAt: true,
        amountCents: true,
        method: true,
        description: true,
        source: true,
      },
    }),
    prisma.patientServiceSession.count({
      where: {
        status: PatientServiceSessionStatus.PENDING,
        purchase: { patientId, professionalUserId: userId },
      },
    }),
  ]);

  const lines: string[] = [
    "FINANCEIRO DO PACIENTE (dados do consultório — use só para responder à pergunta atual):",
    `\nSessões de pacote pendentes (total): ${pendingSessions}`,
  ];

  if (purchases.length === 0) {
    lines.push("\nCompras/pacotes: nenhum registrado.");
  } else {
    lines.push("\nCompras e pacotes (mais recentes):");
    for (const p of purchases) {
      const when = p.purchasedAt.toLocaleDateString("pt-BR");
      const consumed = p.sessions.filter((s) => s.status === PatientServiceSessionStatus.CONSUMED).length;
      const pending = p.sessions.filter((s) => s.status === PatientServiceSessionStatus.PENDING).length;
      const typeLabel = p.type === "PACKAGE" ? "Pacote" : "Avulso";
      lines.push(
        `- ${when} · ${p.service.name} · ${typeLabel} · ${p.sessionCountTotal} sessão(ões) · R$ ${formatBrl(p.agreedPriceCents)} · consumidas ${consumed} · pendentes ${pending}`,
      );
    }
  }

  if (incomeTx.length === 0) {
    lines.push("\nReceitas no caixa (deste paciente): nenhuma registrada.");
  } else {
    lines.push("\nReceitas recentes no caixa:");
    for (const t of incomeTx) {
      const when = t.occurredAt.toLocaleDateString("pt-BR");
      const meth = METHOD_PT[t.method] ?? t.method;
      const desc = t.description?.trim() ? ` · ${sanitizeText(t.description).slice(0, 80)}` : "";
      lines.push(`- ${when} · R$ ${formatBrl(t.amountCents)} · ${meth} · origem ${t.source}${desc}`);
    }
  }

  lines.push(
    "\nNota: valores já registrados no sistema; não invente pagamentos. Para alterar caixa ou pacotes, use o Consultório Financeiro.",
  );

  return truncateBlock(lines.join("\n"));
}
