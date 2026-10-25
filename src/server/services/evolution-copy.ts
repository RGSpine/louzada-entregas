import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import {
  evolutionRowToCopyDraft,
  type EvolutionCopyDraft,
} from "@/lib/evolution-copy-draft";
import {
  buildPatientScopeWhere,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";

export async function getLastEvolutionCopyDraftForUser(
  userId: string,
  patientId: string,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<
  { ok: true; data: EvolutionCopyDraft | null } | { ok: false; error: string }
> {
  const parsed = z.string().uuid().safeParse(patientId);
  if (!parsed.success) {
    return { ok: false, error: "Paciente inválido." };
  }

  const scopeWhere = buildPatientScopeWhere({
    tenantId: userId,
    activeIntraUser,
  });
  const owned = await prisma.patient.findFirst({
    where: { ...scopeWhere, id: parsed.data, ...clinicalPatientWhere },
    select: { id: true },
  });
  if (!owned) {
    return { ok: false, error: "Paciente não encontrado." };
  }

  const row = await prisma.evolution.findFirst({
    where: {
      patientId: parsed.data,
      patient: { userId },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      content: true,
      professionalActions: true,
      patientHandout: true,
      medicationsAndSupplements: true,
      clinicalMeta: true,
    },
  });

  return { ok: true, data: row ? evolutionRowToCopyDraft(row) : null };
}
