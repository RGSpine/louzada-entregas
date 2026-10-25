import { prisma } from "@/lib/prisma";
import { countProfessionalActionItems } from "@/lib/evolution-artifacts";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import {
  buildPatientScopeWhere,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";

export interface PatientWithLastEvolution {
  id: string;
  name: string;
  age: string | null;
  diagnosis: string | null;
  clinicalSummary: string | null;
  firstEvolutionDate: Date | null;
  lastEvolutionDate: Date | null;
  evolutionCount: number;
  pendingProfessionalActionsCount: number;
}

/**
 * Lista pacientes do Tenant com isolamento por userId (LGPD) e segregação
 * intra-tenant por Intra User: um MEMBER só vê seus pacientes ou os compartilhados.
 * Camada compartilhada: Server Actions (web) e API v1 (mobile/desktop).
 *
 * `activeIntraUser` null → escopo vazio (fail-closed via `buildPatientScopeWhere`).
 * Callers autenticados devem passar o perfil ativo (web cookie / API v1 header).
 */
export async function listPatientsForUser(
  userId: string,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<PatientWithLastEvolution[]> {
  const scopeWhere = buildPatientScopeWhere({ tenantId: userId, activeIntraUser });
  const patients = await prisma.patient.findMany({
    where: { ...scopeWhere, ...clinicalPatientWhere },
    select: {
      id: true,
      name: true,
      age: true,
      diagnosis: true,
      clinicalSummary: true,
      lastVisit: true,
      evolutions: {
        orderBy: { date: "asc" },
        select: { date: true },
      },
      _count: {
        select: { evolutions: true },
      },
    },
    orderBy: [{ lastVisit: "desc" }, { updatedAt: "desc" }],
  });

  const patientIds = patients.map((p) => p.id);
  const evolutionsForActions =
    patientIds.length === 0
      ? []
      : await prisma.evolution.findMany({
          where: { patientId: { in: patientIds } },
          select: { patientId: true, date: true, professionalActions: true },
          orderBy: { date: "desc" },
        });

  const latestProfessionalJsonByPatient = new Map<string, unknown>();
  for (const ev of evolutionsForActions) {
    if (!latestProfessionalJsonByPatient.has(ev.patientId)) {
      latestProfessionalJsonByPatient.set(ev.patientId, ev.professionalActions);
    }
  }

  return patients.map((p) => {
    const evolutionDates = p.evolutions.map((e) => e.date);
    const firstDate = evolutionDates.length > 0 ? evolutionDates[0] : null;
    const lastDate =
      evolutionDates.length > 0 ? evolutionDates[evolutionDates.length - 1] : null;
    const profJson = latestProfessionalJsonByPatient.get(p.id);

    return {
      id: p.id,
      name: p.name,
      age: p.age,
      diagnosis: p.diagnosis,
      clinicalSummary: p.clinicalSummary,
      firstEvolutionDate: firstDate,
      lastEvolutionDate: lastDate || p.lastVisit || null,
      evolutionCount: p._count.evolutions,
      pendingProfessionalActionsCount: countProfessionalActionItems(profJson),
    };
  });
}
