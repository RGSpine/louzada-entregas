"use server";

import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import { buildPatientScopeWhere } from "@/lib/intra-user/patient-scope";
import { prisma } from "@/lib/prisma";
import {
  loadSharedCareTimelineForChart,
  type CareTimelineEvent,
} from "@/lib/b2c/care-timeline";

export async function getSharedPatientCareTimeline(
  chartPatientId: string,
): Promise<
  | { success: true; events: CareTimelineEvent[] }
  | { success: false; error: string }
> {
  const scope = await getPatientAccessScope();
  if (!scope || scope.denied || !scope.activeIntraUser) {
    return { success: false, error: "Selecione o perfil profissional para continuar." };
  }
  const id = chartPatientId?.trim();
  if (!id) return { success: false, error: "Paciente inválido." };

  const chart = await prisma.patient.findFirst({
    where: { ...buildPatientScopeWhere(scope), id },
    select: { id: true },
  });
  if (!chart) return { success: true, events: [] };

  const events = await loadSharedCareTimelineForChart({
    tenantUserId: scope.tenantId,
    chartPatientId: chart.id,
  });
  return { success: true, events };
}
