"use server";

import { ESTER_PREMIUM_ERROR } from "@/lib/clinical-chat/ester-branding";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { canUsePatientClinicalChat } from "@/lib/plan-limits";
import {
  sanitizeClinicalChatCitations,
  type ClinicalChatCitation,
} from "@/lib/clinical-chat/citations";
import { getClinicalChatEvidenceQuota } from "@/lib/clinical-chat/evidence-quota";
import {
  CHAT_HISTORY_MESSAGES,
  CHAT_RETENTION_MONTHS,
  CHAT_STORED_MESSAGES_MAX,
} from "@/lib/clinical-chat/constants";
import { pruneClinicalChatMessages } from "@/lib/clinical-chat/retention";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import { scopedPatientWhereOrEmpty } from "@/lib/intra-user/patient-scope";

export type { ClinicalChatCitation };

export type ClinicalChatPatientItem = {
  id: string;
  name: string;
  evolutionCount: number;
  lastVisit: Date | null;
  clinicalSummary: string | null;
};

export type ClinicalChatMessageItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  citations?: ClinicalChatCitation[];
};

export type ListClinicalChatPatientsResult =
  | { success: true; patients: ClinicalChatPatientItem[] }
  | { success: false; error: string };

export type ClinicalChatEvidenceQuotaItem = {
  usedThisMonth: number;
  limitThisMonth: number | null;
  remaining: number | null;
  unlimited: boolean;
};

export type GetClinicalChatEvidenceQuotaResult =
  | { success: true; quota: ClinicalChatEvidenceQuotaItem }
  | { success: false; error: string };

export type GetClinicalChatSessionResult =
  | {
      success: true;
      patient: { id: string; name: string; evolutionCount: number };
      messages: ClinicalChatMessageItem[];
      sessionId: string | null;
      meta: ClinicalChatSessionMeta;
    }
  | { success: false; error: string };

export type ClearClinicalChatSessionResult =
  | { success: true }
  | { success: false; error: string };

export type ClinicalChatSessionMeta = {
  aiContextMessageLimit: number;
  storedMessageLimit: number;
  retentionMonths: number;
  messageCount: number;
};

async function getAuthenticatedDbUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser) return null;

  return prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true, plan: true, email: true, isInfluencer: true },
  });
}

/** Pacientes com pelo menos uma evolução — sidebar do chat clínico. */
export async function listClinicalChatPatients(): Promise<ListClinicalChatPatientsResult> {
  try {
    const dbUser = await getAuthenticatedDbUser();
    if (!dbUser?.id) {
      return { success: false, error: "Não autenticado." };
    }
    if (!canUsePatientClinicalChat(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return { success: false, error: ESTER_PREMIUM_ERROR };
    }

    const listScope = await getPatientAccessScope();
    const listScopeWhere = scopedPatientWhereOrEmpty(dbUser.id, listScope);
    const rows = await prisma.patient.findMany({
      where: {
        ...listScopeWhere,
        evolutions: { some: {} },
      },
      select: {
        id: true,
        name: true,
        lastVisit: true,
        clinicalSummary: true,
        _count: { select: { evolutions: true } },
      },
      orderBy: { name: "asc" },
    });

    return {
      success: true,
      patients: rows.map((p) => ({
        id: p.id,
        name: p.name,
        evolutionCount: p._count.evolutions,
        lastVisit: p.lastVisit,
        clinicalSummary: p.clinicalSummary,
      })),
    };
  } catch (error) {
    console.error("[listClinicalChatPatients]", error);
    return { success: false, error: "Erro ao carregar pacientes." };
  }
}

/** Thread existente de um paciente (se houver). */
export async function getClinicalChatSession(
  patientId: string,
): Promise<GetClinicalChatSessionResult> {
  try {
    const dbUser = await getAuthenticatedDbUser();
    if (!dbUser?.id) {
      return { success: false, error: "Não autenticado." };
    }
    if (!canUsePatientClinicalChat(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return { success: false, error: ESTER_PREMIUM_ERROR };
    }

    const sessionScope = await getPatientAccessScope();
    const sessionScopeWhere = scopedPatientWhereOrEmpty(dbUser.id, sessionScope);
    const patient = await prisma.patient.findFirst({
      where: { ...sessionScopeWhere, id: patientId },
      select: {
        id: true,
        name: true,
        _count: { select: { evolutions: true } },
      },
    });
    if (!patient) {
      return { success: false, error: "Paciente não encontrado." };
    }
    if (patient._count.evolutions < 1) {
      return { success: false, error: "Paciente sem evoluções registradas." };
    }

    const session = await prisma.patientChatSession.findUnique({
      where: { userId_patientId: { userId: dbUser.id, patientId } },
      select: { id: true },
    });

    if (session?.id) {
      await pruneClinicalChatMessages(session.id);
    }

    const storedMessages = session?.id
      ? await prisma.patientChatMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
            citations: true,
          },
        })
      : [];

    const messages: ClinicalChatMessageItem[] = storedMessages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      createdAt: m.createdAt,
      citations:
        m.role === "assistant" ? sanitizeClinicalChatCitations(m.citations) : undefined,
    }));

    return {
      success: true,
      patient: {
        id: patient.id,
        name: patient.name,
        evolutionCount: patient._count.evolutions,
      },
      messages,
      sessionId: session?.id ?? null,
      meta: {
        aiContextMessageLimit: CHAT_HISTORY_MESSAGES,
        storedMessageLimit: CHAT_STORED_MESSAGES_MAX,
        retentionMonths: CHAT_RETENTION_MONTHS,
        messageCount: messages.length,
      },
    };
  } catch (error) {
    console.error("[getClinicalChatSession]", error);
    return { success: false, error: "Erro ao carregar conversa." };
  }
}

/** Cota mensal de buscas de evidência (Perplexity/PubMed) — mês civil UTC. */
export async function fetchClinicalChatEvidenceQuota(): Promise<GetClinicalChatEvidenceQuotaResult> {
  try {
    const dbUser = await getAuthenticatedDbUser();
    if (!dbUser?.id) {
      return { success: false, error: "Não autenticado." };
    }
    if (!canUsePatientClinicalChat(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return { success: false, error: ESTER_PREMIUM_ERROR };
    }
    const quota = await getClinicalChatEvidenceQuota(
      dbUser.id,
      dbUser.email,
      dbUser.isInfluencer,
    );
    return { success: true, quota };
  } catch (error) {
    console.error("[fetchClinicalChatEvidenceQuota]", error);
    return { success: false, error: "Erro ao carregar cota de evidências." };
  }
}

/** Apaga a thread do chat com o paciente (nova conversa). */
export async function clearClinicalChatSession(
  patientId: string,
): Promise<ClearClinicalChatSessionResult> {
  try {
    const dbUser = await getAuthenticatedDbUser();
    if (!dbUser?.id) {
      return { success: false, error: "Não autenticado." };
    }
    if (!canUsePatientClinicalChat(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return { success: false, error: ESTER_PREMIUM_ERROR };
    }

    const clearScope = await getPatientAccessScope();
    const clearScopeWhere = scopedPatientWhereOrEmpty(dbUser.id, clearScope);
    const owned = await prisma.patient.findFirst({
      where: { ...clearScopeWhere, id: patientId },
      select: { id: true },
    });
    if (!owned) {
      return { success: false, error: "Paciente não encontrado." };
    }

    await prisma.patientChatSession.deleteMany({
      where: { userId: dbUser.id, patientId },
    });

    return { success: true };
  } catch (error) {
    console.error("[clearClinicalChatSession]", error);
    return { success: false, error: "Erro ao iniciar nova conversa." };
  }
}
