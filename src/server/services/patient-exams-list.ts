import { prisma } from "@/lib/prisma";
import type { AuthenticatedContext } from "@/lib/auth/session-user";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import { canAccessPatientDocumentsTab } from "@/lib/plan-limits";
import {
  buildPatientScopeWhere,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";
import { z } from "zod";

export type PatientExamListItem = {
  id: string;
  patientId: string;
  title: string | null;
  fileUrl: string;
  fileType: string;
  aiSummary: string | null;
  source: string;
  documentType: string | null;
  createdAt: string;
};

export async function listPatientExamsForUser(
  ctx: AuthenticatedContext,
  patientId: string,
  activeIntraUser: ActiveIntraUser | null = null,
): Promise<
  | { ok: true; exams: PatientExamListItem[] }
  | { ok: false; error: string; planBlocked?: boolean }
> {
  const parsed = z.string().uuid().safeParse(patientId);
  if (!parsed.success) {
    return { ok: false, error: "Paciente inválido." };
  }

  if (
    !canAccessPatientDocumentsTab(
      ctx.dbUser.plan,
      ctx.email,
      ctx.dbUser.isInfluencer,
    )
  ) {
    return {
      ok: false,
      error: "Pasta de exames não disponível no seu plano.",
      planBlocked: true,
    };
  }

  const scopeWhere = buildPatientScopeWhere({
    tenantId: ctx.dbUser.id,
    activeIntraUser,
  });
  const owned = await prisma.patient.findFirst({
    where: { ...scopeWhere, id: parsed.data, ...clinicalPatientWhere },
    select: { id: true },
  });
  if (!owned) {
    return { ok: false, error: "Paciente não encontrado." };
  }

  const exams = await prisma.patientExam.findMany({
    where: { patientId: parsed.data },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      patientId: true,
      title: true,
      fileUrl: true,
      fileType: true,
      aiSummary: true,
      source: true,
      documentType: true,
      createdAt: true,
    },
  });

  return {
    ok: true,
    exams: exams.map((exam) => ({
      ...exam,
      source: String(exam.source),
      createdAt: exam.createdAt.toISOString(),
    })),
  };
}
