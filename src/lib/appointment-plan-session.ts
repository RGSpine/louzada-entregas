import {
  AppointmentVisitKind,
  PatientServiceSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PendingTreatmentPlanSession = {
  id: string;
  sequence: number;
  totalSessions: number;
  serviceName: string;
  professionalServiceId: string;
  allocatedPriceCents: number;
  purchaseId: string;
  serviceSpaceId: string | null;
};

export async function listPendingTreatmentPlanSessionsForPatient(
  professionalUserId: string,
  patientId: string,
  currentAppointmentId?: string,
): Promise<PendingTreatmentPlanSession[]> {
  const sessionAvailabilityFilter = currentAppointmentId
    ? {
        OR: [
          { appointment: { is: null } },
          { appointment: { id: currentAppointmentId } },
        ],
      }
    : { appointment: null };

  const rows = await prisma.patientServiceSession.findMany({
    where: {
      status: PatientServiceSessionStatus.PENDING,
      ...sessionAvailabilityFilter,
      purchase: {
        professionalUserId,
        patientId,
      },
    },
    orderBy: [{ purchase: { purchasedAt: "asc" } }, { sequence: "asc" }],
    select: {
      id: true,
      sequence: true,
      allocatedPriceCents: true,
      purchaseId: true,
      purchase: {
        select: {
          sessionCountTotal: true,
          professionalServiceId: true,
          serviceSpaceId: true,
          service: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    totalSessions: r.purchase.sessionCountTotal,
    serviceName: r.purchase.service.name,
    professionalServiceId: r.purchase.professionalServiceId,
    allocatedPriceCents: r.allocatedPriceCents,
    purchaseId: r.purchaseId,
    serviceSpaceId: r.purchase.serviceSpaceId,
  }));
}

export type ResolveTreatmentPlanSessionResult =
  | {
      ok: true;
      sessionId: string;
      priceCents: number | null;
      professionalServiceId: string | null;
      serviceSpaceId: string | null;
    }
  | { ok: false; error: string };

/**
 * Para visitKind TREATMENT_PLAN: valida sessão explícita ou escolhe a mais antiga pendente.
 */
export async function resolveTreatmentPlanSessionForAppointment(params: {
  professionalUserId: string;
  patientId: string;
  visitKind: AppointmentVisitKind;
  explicitSessionId?: string | null;
  currentAppointmentId?: string;
}): Promise<ResolveTreatmentPlanSessionResult> {
  if (params.visitKind !== AppointmentVisitKind.TREATMENT_PLAN) {
    return {
      ok: true,
      sessionId: "",
      priceCents: null,
      professionalServiceId: null,
      serviceSpaceId: null,
    };
  }

  const sessionAvailabilityFilter = params.currentAppointmentId
    ? {
        OR: [
          { appointment: { is: null } },
          { appointment: { id: params.currentAppointmentId } },
        ],
      }
    : { appointment: null };

  if (params.explicitSessionId) {
    const session = await prisma.patientServiceSession.findFirst({
      where: {
        id: params.explicitSessionId,
        status: PatientServiceSessionStatus.PENDING,
        ...sessionAvailabilityFilter,
        purchase: {
          professionalUserId: params.professionalUserId,
          patientId: params.patientId,
        },
      },
      select: {
        id: true,
        allocatedPriceCents: true,
        purchase: { select: { professionalServiceId: true, serviceSpaceId: true } },
      },
    });
    if (!session) {
      return {
        ok: false,
        error: "Sessão de pacote inválida ou já utilizada.",
      };
    }
    return {
      ok: true,
      sessionId: session.id,
      priceCents: session.allocatedPriceCents > 0 ? session.allocatedPriceCents : null,
      professionalServiceId: session.purchase.professionalServiceId,
      serviceSpaceId: session.purchase.serviceSpaceId,
    };
  }

  const pending = await listPendingTreatmentPlanSessionsForPatient(
    params.professionalUserId,
    params.patientId,
  );
  if (pending.length === 0) {
    return {
      ok: false,
      error:
        "Não há pacote de serviço pendente para este paciente. Registe uma venda no financeiro ou escolha cobrança avulsa.",
    };
  }

  const first = pending[0]!;
  return {
    ok: true,
    sessionId: first.id,
    priceCents: first.allocatedPriceCents > 0 ? first.allocatedPriceCents : null,
    professionalServiceId: first.professionalServiceId,
    serviceSpaceId: first.serviceSpaceId,
  };
}
