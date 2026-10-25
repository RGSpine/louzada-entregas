import { z } from "zod";
import {
  AppointmentConfirmationStatus,
  AppointmentStatus,
  AppointmentVisitKind,
  FinancialTransactionMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerAppointmentCashIncome } from "@/lib/finance/appointment-income";
import { linkFirstPendingSessionFromPurchaseToAppointment } from "@/lib/appointment-package-link";
import { createPatientPurchase } from "@/app/actions/clinic-finances";
import { assertPatientAccessible } from "@/lib/intra-user/patient-access";

const registerAgendaFinanceSchema = z.object({
  appointmentId: z.string().min(1),
  action: z.enum(["register_income", "single_sale", "package_sale"]),
  professionalServiceId: z.string().min(1).optional(),
  agreedPriceCents: z.number().int().min(0).optional(),
  sessionCountTotal: z.number().int().min(2).max(52).optional(),
  paymentMethod: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
});

export type RegisterAgendaFinanceResult =
  | { success: true; message: string }
  | { success: false; error: string };

function isCashVisitKind(visitKind: AppointmentVisitKind): boolean {
  return (
    visitKind === AppointmentVisitKind.UNIQUE_CONSULTATION ||
    visitKind === AppointmentVisitKind.RETURN
  );
}

export async function registerAgendaAppointmentFinanceForUser(
  userId: string,
  input: unknown,
): Promise<RegisterAgendaFinanceResult> {
  const parsed = registerAgendaFinanceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const {
    appointmentId,
    action,
    professionalServiceId: serviceIdInput,
    agreedPriceCents,
    sessionCountTotal,
    paymentMethod,
  } = parsed.data;

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, professionalUserId: userId },
    select: {
      id: true,
      patientId: true,
      status: true,
      visitKind: true,
      priceCents: true,
      startAt: true,
      professionalServiceId: true,
      patientServiceSessionId: true,
    },
  });

  if (!appt) {
    return { success: false, error: "Marcação não encontrada." };
  }

  if (appt.status === AppointmentStatus.CANCELLED || appt.status === AppointmentStatus.NO_SHOW) {
    return { success: false, error: appt.status === AppointmentStatus.NO_SHOW ? "Marcação marcada como falta." : "Marcação cancelada." };
  }

  const serviceId = serviceIdInput ?? appt.professionalServiceId ?? undefined;
  const method = paymentMethod ?? FinancialTransactionMethod.PIX;

  if (action === "register_income") {
    if (!isCashVisitKind(appt.visitKind)) {
      return {
        success: false,
        error: "Sessões de pacote usam o financeiro da venda do pacote, não entrada avulsa.",
      };
    }

    if (!appt.patientId) {
      return { success: false, error: "Marcação sem paciente vinculado." };
    }
    // Escopo MEMBER: não registrar receita em paciente fora do owner/shared.
    const patientAccess = await assertPatientAccessible(appt.patientId);
    if (!patientAccess.ok) {
      return {
        success: false,
        error: patientAccess.error ?? "Paciente não encontrado ou sem permissão.",
      };
    }

    if (appt.status !== AppointmentStatus.COMPLETED) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          status: AppointmentStatus.COMPLETED,
          confirmationStatus: AppointmentConfirmationStatus.CONFIRMED,
        },
      });
    }

    const income = await registerAppointmentCashIncome(userId, appt.id, { paymentMethod: method });
    if (!income.registered) {
      return { success: false, error: income.reason };
    }

    return {
      success: true,
      message: `Entrada de R$ ${(income.amountCents / 100).toFixed(2).replace(".", ",")} registrada no financeiro.`,
    };
  }

  if (!serviceId) {
    return {
      success: false,
      error: "Selecione o serviço na marcação ou no fluxo financeiro.",
    };
  }

  const price =
    agreedPriceCents ??
    (appt.priceCents != null && appt.priceCents > 0 ? appt.priceCents : undefined);

  if (price === undefined) {
    return { success: false, error: "Informe o valor da venda." };
  }

  const occurredAt = appt.startAt;

  if (action === "single_sale") {
    const purchase = await createPatientPurchase({
      patientId: appt.patientId,
      professionalServiceId: serviceId,
      type: "SINGLE",
      agreedPriceCents: price,
      registerIncomePayment: true,
      paymentMethod: method,
      paymentOccurredAt: occurredAt,
      paymentDescription: "Venda avulsa via agenda",
      idempotencyKey: `agenda-sale:${appt.id}:single`,
      originAppointmentId: appt.id,
    });

    if (!purchase.success) {
      return { success: false, error: purchase.error };
    }

    if (!appt.professionalServiceId || appt.priceCents == null) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          professionalServiceId: serviceId,
          priceCents: price,
          ...(appt.visitKind === AppointmentVisitKind.TREATMENT_PLAN
            ? { visitKind: AppointmentVisitKind.UNIQUE_CONSULTATION }
            : {}),
        },
      });
    }

    return { success: true, message: "Venda avulsa registrada no financeiro." };
  }

  if (!sessionCountTotal || sessionCountTotal < 2) {
    return { success: false, error: "Informe pelo menos 2 sessões para o pacote." };
  }

  const purchase = await createPatientPurchase({
    patientId: appt.patientId,
    professionalServiceId: serviceId,
    type: "PACKAGE",
    agreedPriceCents: price,
    sessionCountTotal,
    registerIncomePayment: true,
    paymentMethod: method,
    paymentOccurredAt: occurredAt,
    paymentDescription: "Venda de pacote via agenda",
    idempotencyKey: `agenda-sale:${appt.id}:package`,
    originAppointmentId: appt.id,
  });

  if (!purchase.success) {
    return { success: false, error: purchase.error };
  }

  const purchaseId = purchase.data?.purchaseId;
  if (!purchaseId) {
    return { success: false, error: "Venda criada mas ID da compra não retornado." };
  }

  let linkNote = "";
  if (!appt.patientServiceSessionId) {
    const link = await linkFirstPendingSessionFromPurchaseToAppointment({
      professionalUserId: userId,
      appointmentId: appt.id,
      purchaseId,
      professionalServiceId: serviceId,
    });
    if (link.linked) {
      linkNote = ` Sessão ${link.sequence}/${sessionCountTotal} vinculada a esta marcação.`;
    }
  } else if (!appt.professionalServiceId) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { professionalServiceId: serviceId },
    });
  }

  return {
    success: true,
    message: `Pacote de ${sessionCountTotal} sessões registrado no financeiro.${linkNote}`,
  };
}
