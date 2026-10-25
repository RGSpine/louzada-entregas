import {
  AppointmentVisitKind,
  PatientServiceSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Após venda de pacote, liga a 1.ª sessão pendente da compra à marcação atual.
 */
export async function linkFirstPendingSessionFromPurchaseToAppointment(params: {
  professionalUserId: string;
  appointmentId: string;
  purchaseId: string;
  professionalServiceId: string;
}): Promise<
  | { linked: true; sessionId: string; sequence: number; priceCents: number | null }
  | { linked: false; reason: string }
> {
  const appt = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, professionalUserId: params.professionalUserId },
    select: { id: true, patientId: true, patientServiceSessionId: true, status: true },
  });

  if (!appt) {
    return { linked: false, reason: "Marcação não encontrada." };
  }

  if (appt.patientServiceSessionId) {
    return { linked: false, reason: "Marcação já tem sessão de pacote vinculada." };
  }

  const session = await prisma.patientServiceSession.findFirst({
    where: {
      purchaseId: params.purchaseId,
      status: PatientServiceSessionStatus.PENDING,
      appointment: { is: null },
      purchase: {
        professionalUserId: params.professionalUserId,
        patientId: appt.patientId,
        professionalServiceId: params.professionalServiceId,
      },
    },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, allocatedPriceCents: true },
  });

  if (!session) {
    return { linked: false, reason: "Nenhuma sessão pendente disponível na compra." };
  }

  const priceCents = session.allocatedPriceCents > 0 ? session.allocatedPriceCents : null;

  await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      visitKind: AppointmentVisitKind.TREATMENT_PLAN,
      patientServiceSessionId: session.id,
      professionalServiceId: params.professionalServiceId,
      priceCents,
    },
  });

  return {
    linked: true,
    sessionId: session.id,
    sequence: session.sequence,
    priceCents,
  };
}
