/**
 * Catálogo leve de exames do paciente para resolução sob demanda no chat.
 */
import { prisma } from "@/lib/prisma";

export type PatientExamCatalogEntry = {
  id: string;
  title: string;
  createdAt: Date;
  fileType: string;
  fileUrl: string;
  hasAiSummary: boolean;
};

export async function loadPatientExamCatalog(
  patientId: string,
  userId: string,
): Promise<PatientExamCatalogEntry[]> {
  const rows = await prisma.patientExam.findMany({
    where: { patientId, patient: { userId } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      createdAt: true,
      fileType: true,
      fileUrl: true,
      aiSummary: true,
      source: true,
      documentType: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title:
      r.title?.trim() ||
      (r.source === "AI_GENERATED" && r.documentType
        ? `Documento ${r.documentType}`
        : "Exame/documento"),
    createdAt: r.createdAt,
    fileType: r.fileType,
    fileUrl: r.fileUrl,
    hasAiSummary: Boolean(r.aiSummary?.trim()),
  }));
}

export async function getPatientExamForAnalysis(
  examId: string,
  patientId: string,
  userId: string,
): Promise<PatientExamCatalogEntry | null> {
  const row = await prisma.patientExam.findFirst({
    where: { id: examId, patientId, patient: { userId } },
    select: {
      id: true,
      title: true,
      createdAt: true,
      fileType: true,
      fileUrl: true,
      aiSummary: true,
      source: true,
      documentType: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title:
      row.title?.trim() ||
      (row.source === "AI_GENERATED" && row.documentType
        ? `Documento ${row.documentType}`
        : "Exame/documento"),
    createdAt: row.createdAt,
    fileType: row.fileType,
    fileUrl: row.fileUrl,
    hasAiSummary: Boolean(row.aiSummary?.trim()),
  };
}
