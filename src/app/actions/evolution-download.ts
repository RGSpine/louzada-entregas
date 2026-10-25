"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { clinicalPatientWhere } from "@/lib/patient-clinical-scope";
import {
  getPatientAccessScope,
  PROFILE_REQUIRED_ERROR,
} from "@/lib/intra-user/patient-access";
import { buildPatientScopeWhere } from "@/lib/intra-user/patient-scope";
import { medicationsAndSupplementsStoredSchema } from "@/lib/evolution-artifacts";
import {
  HISTORY_IMPORT_PLATFORM_LABELS,
  type HistoryImportPlatform,
} from "@/lib/patient-history-import";
import { formatEvolutionAttendanceDatePtBr } from "@/lib/patient-profile";
import { resolvePatientAgeLabel } from "@/lib/patient-age";
import { enforceRateLimit, EVOLUTION_PDF_DOWNLOAD_RATE_LIMIT } from "@/lib/rate-limit";
import { generateEvolutionPdfForUser } from "@/server/services/evolution-pdf";
import { extractLegacyFormFieldsFromContent } from "@/lib/evolution-copy-draft";

const downloadSchema = z.object({
  evolutionId: z.string().uuid(),
});

export type DownloadPatientEvolutionPdfResult = {
  success: boolean;
  pdfUrl?: string;
  pdfBase64?: string;
  fileName?: string;
  error?: string;
};

function importedFromLabel(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (raw in HISTORY_IMPORT_PLATFORM_LABELS) {
    return HISTORY_IMPORT_PLATFORM_LABELS[raw as HistoryImportPlatform];
  }
  return "outra plataforma";
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) return null;
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true },
  });
  return dbUser?.id ?? null;
}

async function persistEvolutionPdf(
  evolutionId: string,
  userId: string,
  patientName: string,
  pdfBase64: string,
): Promise<string | undefined> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    const safeUser = userId.replace(/[^a-zA-Z0-9]/g, "_");
    const safeName = patientName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
    const storagePath = `${safeUser}/${Date.now()}-${safeName}-${evolutionId.slice(0, 8)}.pdf`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("evolutions")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError || !uploadData) {
      console.error("[downloadPatientEvolutionPdf] upload:", uploadError?.message);
      return undefined;
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("evolutions")
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrlData.publicUrl;
    await prisma.evolution.update({
      where: { id: evolutionId },
      data: { pdfUrl },
    });
    return pdfUrl;
  } catch (error) {
    console.error("[downloadPatientEvolutionPdf] persist:", error);
    return undefined;
  }
}

/**
 * Devolve PDF da evolução no mesmo formato das nativas (EVOLUÇÃO CLÍNICA).
 * Se ainda não houver ficheiro (ex.: importada de outra plataforma), gera, guarda e devolve.
 */
export async function downloadPatientEvolutionPdf(
  evolutionId: string,
): Promise<DownloadPatientEvolutionPdfResult> {
  const parsed = downloadSchema.safeParse({ evolutionId });
  if (!parsed.success) {
    return { success: false, error: "Evolução inválida." };
  }

  const dbUserId = await getAuthenticatedUserId();
  if (!dbUserId) {
    return { success: false, error: "Usuário não autenticado." };
  }

  const rl = await enforceRateLimit(
    `evolution-pdf:${dbUserId}`,
    EVOLUTION_PDF_DOWNLOAD_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Tente novamente em ${rl.resetIn}s.` };
  }

  const scope = await getPatientAccessScope();
  if (!scope || scope.denied || !scope.activeIntraUser) {
    return { success: false, error: PROFILE_REQUIRED_ERROR };
  }

  const evolution = await prisma.evolution.findFirst({
    where: {
      id: parsed.data.evolutionId,
      patient: {
        ...buildPatientScopeWhere(scope),
        ...clinicalPatientWhere,
      },
    },
    select: {
      id: true,
      date: true,
      content: true,
      pdfUrl: true,
      source: true,
      importedFrom: true,
      clinicalMeta: true,
      medicationsAndSupplements: true,
      patient: {
        select: { name: true, age: true, dateOfBirth: true, diagnosis: true },
      },
    },
  });

  if (!evolution) {
    return { success: false, error: "Evolução não encontrada." };
  }

  const attendanceDate = formatEvolutionAttendanceDatePtBr(evolution.date);
  const fileName = `${attendanceDate.replace(/\//g, "-")} - ${evolution.patient.name}.pdf`;

  // Nativas com PDF já gerado na Nova Evolução reutilizam o ficheiro.
  // Importadas regeneram para incluir logo/dados atuais do profissional.
  if (evolution.pdfUrl && evolution.source !== "IMPORTED") {
    return { success: true, pdfUrl: evolution.pdfUrl, fileName };
  }

  const content = (evolution.content ?? "").trim();
  if (content.length < 1) {
    return { success: false, error: "Esta evolução não tem texto para gerar o PDF." };
  }

  const meta =
    evolution.clinicalMeta && typeof evolution.clinicalMeta === "object"
      ? (evolution.clinicalMeta as Record<string, unknown>)
      : {};
  const queixaMeta = metaString(meta, "formQueixa");
  const condutaMeta = metaString(meta, "formConduta");
  const diagnosticoMeta = metaString(meta, "formDiagnostico");
  const legacy =
    evolution.source !== "IMPORTED" && (!queixaMeta || !condutaMeta)
      ? extractLegacyFormFieldsFromContent(content)
      : { queixa: "", conduta: "" };

  const importedLabel = importedFromLabel(evolution.importedFrom);
  const originNote =
    evolution.source === "IMPORTED"
      ? `Importada de ${importedLabel ?? "outra plataforma"}`
      : undefined;

  const medsParsed = medicationsAndSupplementsStoredSchema.safeParse(
    evolution.medicationsAndSupplements,
  );

  const generated = await generateEvolutionPdfForUser(dbUserId, {
    patientName: evolution.patient.name,
    patientAge:
      resolvePatientAgeLabel({
        dateOfBirth: evolution.patient.dateOfBirth,
        fallbackAge: evolution.patient.age,
        at: evolution.date,
      }) ?? undefined,
    patientDiagnosis: evolution.patient.diagnosis ?? undefined,
    attendanceDate,
    queixa: queixaMeta || legacy.queixa || undefined,
    diagnostico: diagnosticoMeta || evolution.patient.diagnosis || undefined,
    conduta: condutaMeta || legacy.conduta || undefined,
    content,
    medicationsAndSupplements: medsParsed.success ? medsParsed.data : undefined,
    originNote,
  });

  if (!generated.success) {
    return { success: false, error: generated.error };
  }

  const pdfUrl = await persistEvolutionPdf(
    evolution.id,
    dbUserId,
    evolution.patient.name,
    generated.pdfBase64,
  );

  return {
    success: true,
    pdfBase64: generated.pdfBase64,
    pdfUrl,
    fileName: generated.fileName,
  };
}
