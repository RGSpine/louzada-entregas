/**
 * Lógica compartilhada entre POST /api/finance-agent (síncrono) e o worker assíncrono.
 */
import { prisma } from "@/lib/prisma";
import { effectivePlanForFeatures, getPlanLimits } from "@/lib/plan-limits";
import { transcribeAgentMedia } from "@/lib/finance/agent-transcribe";
import { runFinanceAgent } from "@/lib/finance/agent";
import type { FinanceAgentProposal } from "@/lib/finance/agent";
import { getFinancePeriodReportForUser } from "@/lib/finance/period-report";
import { buildFinanceHealthNarrative } from "@/lib/finance/finance-health-narrative";
import {
  buildPatientScopeWhere,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";

export type FinanceAgentPatientScope = {
  /** Plano de equipe (Consultório/Clínica) com Intra Users. */
  isClinica: boolean;
  activeIntraUser: ActiveIntraUser | null;
};

export type FinanceAgentRunInput = {
  professionalUserId: string;
  userPlan: string | null;
  userEmail: string | null;
  isInfluencer: boolean;
  typedText: string;
  audio?: { mimeType: string; base64: string } | null;
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
  /**
   * Relatório completo (despesas/líquido) só para ADMIN.
   * Fail-closed: omitido/false → não materializa report.
   */
  allowPeriodReport?: boolean;
  /**
   * Escopo de pacientes no prompt da IA.
   * Fail-closed: omitido → nenhum paciente (evita vazamento cross-MEMBER em jobs antigos).
   */
  patientScope?: FinanceAgentPatientScope;
};

export type FinanceAgentRunResult =
  | {
      ok: true;
      proposal: FinanceAgentProposal;
      report: unknown;
      transcript: string | null;
      limits: { maxAudioMinutes: number; attachmentsAllowed: boolean };
    }
  | { ok: false; error: string };

export async function runFinanceAgentRequest(
  input: FinanceAgentRunInput,
): Promise<FinanceAgentRunResult> {
  const {
    professionalUserId,
    userPlan,
    userEmail,
    isInfluencer,
    typedText,
    audio,
    images,
    allowPeriodReport = false,
    patientScope,
  } = input;

  const effectivePlan = effectivePlanForFeatures(userPlan, isInfluencer);
  const planAllowsAttachments = effectivePlan !== "BASICO";
  const limits = getPlanLimits(userPlan, userEmail, isInfluencer);

  let mediaText = "";
  if (audio?.base64 || (images?.length ?? 0) > 0) {
    mediaText = await transcribeAgentMedia({
      audio: audio ?? null,
      images: images ?? [],
    });
  }

  const combinedText = [typedText, mediaText].filter((s) => s && s.trim()).join("\n\n").trim();
  if (!combinedText) {
    return { ok: false, error: "Não foi possível extrair conteúdo do envio." };
  }

  const patientWhere = patientScope
    ? buildPatientScopeWhere({
        tenantId: professionalUserId,
        activeIntraUser: patientScope.activeIntraUser,
        whenNoProfile: patientScope.isClinica ? "deny" : "tenant",
      })
    : { id: { in: [] as string[] } };

  // Despesas fixas só no prompt de ADMIN (relatório / visão completa do caixa).
  const recurringPromise = allowPeriodReport
    ? prisma.recurringExpense.findMany({
        where: { professionalUserId, active: true },
        select: { name: true, amountCents: true, category: true },
        orderBy: { name: "asc" },
        take: 100,
      })
    : Promise.resolve(
        [] as Array<{ name: string; amountCents: number; category: string | null }>,
      );

  const [patients, services, recurring] = await Promise.all([
    prisma.patient.findMany({
      where: patientWhere,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.professionalService.findMany({
      where: { userId: professionalUserId, active: true },
      select: { id: true, name: true, defaultPriceCents: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    recurringPromise,
  ]);

  const result = await runFinanceAgent(combinedText, {
    patients,
    services,
    recurringExpenses: recurring,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  let report: unknown = null;
  if (result.proposal.model.intent === "report") {
    if (!allowPeriodReport) {
      return {
        ok: false,
        error:
          "Relatórios financeiros (bruto, despesas e líquido) estão disponíveis apenas para administradores da clínica.",
      };
    }
    const rep = await getFinancePeriodReportForUser(professionalUserId, {
      preset: result.proposal.model.reportPreset ?? "MONTH",
      offset: result.proposal.model.reportOffset ?? 0,
    });
    if (rep.success && rep.data) {
      report = rep.data;
      result.proposal.model.assistantMessage = buildFinanceHealthNarrative(
        rep.data,
        result.proposal.model.assistantMessage,
      );
    }
  }

  return {
    ok: true,
    proposal: result.proposal,
    report,
    transcript: mediaText || null,
    limits: { maxAudioMinutes: limits.maxAudioMinutes, attachmentsAllowed: planAllowsAttachments },
  };
}
