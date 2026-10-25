import {
  AppointmentStatus,
  AppointmentVisitKind,
  FinancialEntrySource,
  FinancialTransactionKind,
  FinancialTransactionMethod,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatVisitKindLabel } from "@/lib/appointment-visit-meta";
import { appointmentPatientDisplayName } from "@/lib/patient-clinical-scope";
import { sanitizeText } from "@/lib/sanitize";
import {
  onAppointmentMarkedCompleted,
  type AppointmentConsumptionHint,
} from "@/lib/finance/reconcile-session";
import { canUseOfficeFinance } from "@/lib/plan-limits";
import { OFFICE_FINANCE_PLAN_ERROR } from "@/lib/office-finance-access";

export type RegisterAppointmentIncomeResult =
  | { registered: true; transactionId: string; amountCents: number }
  | { registered: false; reason: string };

export type AppointmentCompletionEffects = {
  sessionConsumed: boolean;
  incomeRegistered: boolean;
  incomeAmountCents?: number;
};

export function isCashAppointmentVisitKind(visitKind: AppointmentVisitKind): boolean {
  return (
    visitKind === AppointmentVisitKind.UNIQUE_CONSULTATION ||
    visitKind === AppointmentVisitKind.RETURN
  );
}

export function buildAppointmentIncomeDescription(input: {
  visitKind: AppointmentVisitKind;
  patientDisplayName: string;
}): string {
  return sanitizeText(
    `${formatVisitKindLabel(input.visitKind)} — ${input.patientDisplayName.trim()}`,
  );
}

/**
 * Registra receita no caixa para consulta/retorno realizados com valor definido.
 * Idempotente por appointmentId. Tratamento/plano ignora (receita do pacote já no financeiro).
 */
export async function registerAppointmentCashIncome(
  professionalUserId: string,
  appointmentId: string,
  options?: { paymentMethod?: FinancialTransactionMethod },
): Promise<RegisterAppointmentIncomeResult> {
  const planUser = await prisma.user.findUnique({
    where: { id: professionalUserId },
    select: { plan: true, email: true, isInfluencer: true },
  });
  if (
    !planUser ||
    !canUseOfficeFinance(planUser.plan, planUser.email, planUser.isInfluencer)
  ) {
    return { registered: false, reason: OFFICE_FINANCE_PLAN_ERROR };
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, professionalUserId },
    select: {
      id: true,
      status: true,
      visitKind: true,
      priceCents: true,
      startAt: true,
      patientId: true,
      title: true,
      source: true,
      patientServiceSessionId: true,
      patient: { select: { name: true } },
      originatedPurchase: {
        select: {
          id: true,
          transactions: {
            where: { kind: FinancialTransactionKind.INCOME, voidedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
      serviceSpaceId: true,
    },
  });

  if (!appt) {
    return { registered: false, reason: "Marcação não encontrada." };
  }

  if (appt.status !== AppointmentStatus.COMPLETED) {
    return { registered: false, reason: "Marcação ainda não está realizada." };
  }

  if (!isCashAppointmentVisitKind(appt.visitKind)) {
    return {
      registered: false,
      reason: "Tratamento/plano usa o financeiro do pacote; não duplica receita aqui.",
    };
  }

  if (appt.priceCents == null || appt.priceCents <= 0) {
    return { registered: false, reason: "Marcação sem valor definido." };
  }

  if (appt.originatedPurchase) {
    return {
      registered: false,
      reason: appt.originatedPurchase.transactions.length
        ? "Receita já registrada pela venda vinculada a esta marcação."
        : "Esta marcação já tem venda vinculada. Registre o pagamento da compra, não uma entrada avulsa.",
    };
  }

  const existing = await prisma.financialTransaction.findFirst({
    where: { appointmentId: appt.id, voidedAt: null },
    select: { id: true },
  });
  if (existing) {
    return { registered: false, reason: "Receita já registrada para esta marcação." };
  }

  const patientDisplayName = appointmentPatientDisplayName({
    source: appt.source,
    title: appt.title,
    patientName: appt.patient.name,
  });

  try {
    const tx = await prisma.financialTransaction.create({
      data: {
        professionalUserId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        kind: FinancialTransactionKind.INCOME,
        amountCents: appt.priceCents,
        occurredAt: appt.startAt,
        method: options?.paymentMethod ?? FinancialTransactionMethod.OTHER,
        description: buildAppointmentIncomeDescription({
          visitKind: appt.visitKind,
          patientDisplayName,
        }),
        source: FinancialEntrySource.AGENDA,
        serviceSpaceId: appt.serviceSpaceId,
      },
      select: { id: true },
    });

    return {
      registered: true,
      transactionId: tx.id,
      amountCents: appt.priceCents,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { registered: false, reason: "Receita já registrada para esta marcação." };
    }
    throw e;
  }
}

/** Consumo de sessão de pacote + receita avulsa ao concluir marcação. */
export async function runAppointmentCompletionFinanceEffects(
  hint: AppointmentConsumptionHint,
): Promise<AppointmentCompletionEffects> {
  const sessionResult = await onAppointmentMarkedCompleted(hint);
  const incomeResult = await registerAppointmentCashIncome(hint.professionalUserId, hint.id);

  if (sessionResult.consumed && sessionResult.sessionId) {
    try {
      const { loadEvolutionSessionConsumptionSummary } = await import(
        "@/lib/finance/evolution-session-consumption-load"
      );
      const { maybeNotifyPackageNearEndFromConsumption } = await import(
        "@/lib/push-notifications/dispatch"
      );
      const summary = await loadEvolutionSessionConsumptionSummary(sessionResult.sessionId);
      if (summary) {
        await maybeNotifyPackageNearEndFromConsumption({
          userId: hint.professionalUserId,
          summary,
        });
      }
    } catch (err) {
      console.error("[runAppointmentCompletionFinanceEffects] aviso fim de plano:", err);
    }
  }

  return {
    sessionConsumed: sessionResult.consumed,
    incomeRegistered: incomeResult.registered,
    incomeAmountCents: incomeResult.registered ? incomeResult.amountCents : undefined,
  };
}
