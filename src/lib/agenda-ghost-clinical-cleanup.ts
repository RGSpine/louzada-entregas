import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Fichas clínicas “fantasma” de agenda (legado pré-agendaOnly):
 * têm marcação, zero dados clínicos/financeiro/chat, e não foram um cadastro
 * tradicional vazio (exige pelo menos uma Appointment).
 */
export const agendaGhostClinicalPatientWhere: Prisma.PatientWhereInput = {
  agendaOnly: false,
  evolutions: { none: {} },
  exams: { none: {} },
  patientServicePurchases: { none: {} },
  financialTransactions: { none: {} },
  chatSession: { is: null },
  age: null,
  diagnosis: null,
  history: null,
  clinicalSummary: null,
  // Cadastro tradicional sem marcação NÃO entra — só fantasmas da agenda.
  appointments: { some: {} },
};

export type DemoteAgendaGhostResult = {
  demoted: number;
  patientIds: string[];
  patientCountDecrements: Array<{ userId: string; by: number }>;
};

/**
 * Converte fantasmas clínicos em placeholders `agendaOnly` (somem da lista Pacientes).
 * Ajusta `User.patientCount` por tenant. Idempotente.
 */
export async function demoteAgendaGhostClinicalPatients(params?: {
  userId?: string;
  dryRun?: boolean;
}): Promise<DemoteAgendaGhostResult> {
  const where: Prisma.PatientWhereInput = {
    ...agendaGhostClinicalPatientWhere,
    ...(params?.userId ? { userId: params.userId } : {}),
  };

  const ghosts = await prisma.patient.findMany({
    where,
    select: { id: true, userId: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  if (params?.dryRun || ghosts.length === 0) {
    const byUser = new Map<string, number>();
    for (const g of ghosts) {
      if (!g.userId) continue;
      byUser.set(g.userId, (byUser.get(g.userId) ?? 0) + 1);
    }
    return {
      demoted: params?.dryRun ? 0 : ghosts.length,
      patientIds: ghosts.map((g) => g.id),
      patientCountDecrements: [...byUser.entries()].map(([userId, by]) => ({
        userId,
        by,
      })),
    };
  }

  const byUser = new Map<string, number>();
  for (const g of ghosts) {
    if (!g.userId) continue;
    byUser.set(g.userId, (byUser.get(g.userId) ?? 0) + 1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.patient.updateMany({
      where: { id: { in: ghosts.map((g) => g.id) } },
      data: { agendaOnly: true },
    });
    for (const [userId, by] of byUser) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { patientCount: true },
      });
      if (!user) continue;
      const next = Math.max(0, user.patientCount - by);
      await tx.user.update({
        where: { id: userId },
        data: { patientCount: next },
      });
    }
  });

  return {
    demoted: ghosts.length,
    patientIds: ghosts.map((g) => g.id),
    patientCountDecrements: [...byUser.entries()].map(([userId, by]) => ({
      userId,
      by,
    })),
  };
}
