"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import {
  canAccessPatientDocumentsTab,
  canUsePatientExamFolder,
} from "@/lib/plan-limits";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import {
  buildPatientScopeWhere,
  scopedPatientWhereOrEmpty,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";

const EXAMS_BUCKET = "patient-exams";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB (alinhado ao limite defensivo de outras rotas)

export interface PatientExamSummary {
  id: string;
  patientId: string;
  title: string | null;
  fileUrl: string;
  fileType: string;
  aiSummary: string | null;
  source: "MANUAL_UPLOAD" | "AI_GENERATED";
  documentType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListPatientExamsResult {
  success: boolean;
  exams?: PatientExamSummary[];
  error?: string;
}

export interface UploadPatientExamResult {
  success: boolean;
  exam?: PatientExamSummary;
  error?: string;
}

export interface DeletePatientExamResult {
  success: boolean;
  error?: string;
}

export interface PatientExamFolderAccessResult {
  success: boolean;
  allowed?: boolean;
  error?: string;
}

/**
 * Indica se o usuário pode usar a Pasta de Exames (PRO ou Super Admin).
 * Use no cliente para decidir se mostra a UI completa ou o upsell.
 */
export async function getPatientExamFolderAccess(): Promise<PatientExamFolderAccessResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado.", allowed: false };
    }
    return {
      success: true,
      allowed: canUsePatientExamFolder(dbUser.plan, dbUser.email, dbUser.isInfluencer),
    };
  } catch (error) {
    console.error("[getPatientExamFolderAccess]", error);
    return {
      success: false,
      allowed: false,
      error: error instanceof Error ? error.message : "Erro ao verificar acesso.",
    };
  }
}

export interface PatientDocumentsAccessResult {
  success: boolean;
  tabAllowed?: boolean;
  manualUploadAllowed?: boolean;
  error?: string;
}

/** Aba Exames/Documentos (lista) vs upload manual (PRO). */
export async function getPatientDocumentsAccess(): Promise<PatientDocumentsAccessResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não autenticado.",
        tabAllowed: false,
        manualUploadAllowed: false,
      };
    }
    return {
      success: true,
      tabAllowed: canAccessPatientDocumentsTab(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer
      ),
      manualUploadAllowed: canUsePatientExamFolder(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer
      ),
    };
  } catch (error) {
    console.error("[getPatientDocumentsAccess]", error);
    return {
      success: false,
      tabAllowed: false,
      manualUploadAllowed: false,
      error: error instanceof Error ? error.message : "Erro ao verificar acesso.",
    };
  }
}

async function getDbUserWithPlan(): Promise<{
  id: string;
  plan: string | null;
  email: string | null;
  isInfluencer: boolean;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return null;
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: { id: true, plan: true, email: true, isInfluencer: true },
  });

  return dbUser;
}

async function assertPatientOwned(
  patientId: string,
  userId: string,
  activeIntraUser?: ActiveIntraUser | null,
): Promise<boolean> {
  const where =
    activeIntraUser !== undefined
      ? buildPatientScopeWhere({ tenantId: userId, activeIntraUser })
      : scopedPatientWhereOrEmpty(userId, await getPatientAccessScope());
  const patient = await prisma.patient.findFirst({
    where: { ...where, id: patientId },
    select: { id: true },
  });
  return !!patient;
}

/**
 * Após salvar evolução: copia anexos da etapa de exames para a pasta do paciente (PRO).
 * Erros por arquivo ou de infra são ignorados — não altera o fluxo do PDF nem do histórico.
 */
export async function persistEvolutionExamAttachmentsSilently(
  patientId: string,
  attachments: { base64: string; mimeType: string; fileName: string }[]
): Promise<void> {
  if (!attachments.length) return;
  try {
    const dbUser = await getDbUserWithPlan();
    if (
      !dbUser ||
      !canUsePatientExamFolder(dbUser.plan, dbUser.email, dbUser.isInfluencer)
    ) {
      return;
    }
    if (!(await assertPatientOwned(patientId, dbUser.id))) return;

    const supabaseAdmin = createSupabaseAdminClient();

    for (const att of attachments) {
      try {
        const mimeType = att.mimeType || "application/octet-stream";
        if (!ALLOWED_MIME.has(mimeType)) continue;

        const buffer = Buffer.from(att.base64, "base64");
        if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) continue;

        const safeName = sanitizeFileName(att.fileName || "arquivo");
        const objectPath = `${dbUser.id}/${patientId}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from(EXAMS_BUCKET)
          .upload(objectPath, buffer, {
            contentType: mimeType,
            upsert: false,
          });

        if (uploadError) continue;

        const { data: publicUrlData } = supabaseAdmin.storage
          .from(EXAMS_BUCKET)
          .getPublicUrl(objectPath);

        const titleRaw = att.fileName?.replace(/\.[^.]+$/, "")?.trim() || "";
        const title =
          titleRaw.length > 0 ? titleRaw.slice(0, 200) : null;

        await prisma.patientExam.create({
          data: {
            patientId,
            title,
            fileUrl: publicUrlData.publicUrl,
            fileType: mimeType,
            source: "MANUAL_UPLOAD",
          },
        });
      } catch {
        /* um anexo falhou — segue */
      }
    }

    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${patientId}`);
  } catch {
    /* silencioso */
  }
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return base.length > 0 ? base : "arquivo";
}

function storageObjectPathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${EXAMS_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(publicUrl.slice(idx + marker.length));
  } catch {
    return publicUrl.slice(idx + marker.length);
  }
}

/**
 * Lista exames/documentos da pasta do paciente (FREE+ para ver; upload manual continua PRO).
 */
export async function listPatientExams(patientId: string): Promise<ListPatientExamsResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    if (
      !canAccessPatientDocumentsTab(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer
      )
    ) {
      return {
        success: false,
        error: "Acesso à pasta de documentos não disponível.",
      };
    }

    const owned = await assertPatientOwned(patientId, dbUser.id);
    if (!owned) {
      return { success: false, error: "Paciente não encontrado ou acesso negado." };
    }

    const exams = await prisma.patientExam.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, exams };
  } catch (error) {
    console.error("[listPatientExams]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao listar exames.",
    };
  }
}

/**
 * Upload de arquivo (PDF ou imagem) para a pasta de exames do paciente.
 * Envie via FormData: `patientId`, `file` (File), opcional `title` (string).
 */
export async function uploadPatientExam(formData: FormData): Promise<UploadPatientExamResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    if (!canUsePatientExamFolder(dbUser.plan, dbUser.email, dbUser.isInfluencer)) {
      return {
        success: false,
        error: "Pasta de Exames está disponível no plano PREMIUM.",
      };
    }

    const patientId = formData.get("patientId");
    if (typeof patientId !== "string" || !patientId.trim()) {
      return { success: false, error: "ID do paciente inválido." };
    }

    const owned = await assertPatientOwned(patientId, dbUser.id);
    if (!owned) {
      return { success: false, error: "Paciente não encontrado ou acesso negado." };
    }

    const titleRaw = formData.get("title");
    const title =
      typeof titleRaw === "string" && titleRaw.trim() !== "" ? titleRaw.trim() : null;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "Selecione um arquivo válido." };
    }

    if (file.size > MAX_FILE_BYTES) {
      return { success: false, error: "Arquivo muito grande (máx. 8 MB)." };
    }

    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mimeType)) {
      return {
        success: false,
        error: "Tipo não permitido. Use PDF ou imagem (JPEG, PNG, WebP, GIF).",
      };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitizeFileName(file.name || "arquivo");
    const objectPath = `${dbUser.id}/${patientId}/${Date.now()}-${safeName}`;

    const supabaseAdmin = createSupabaseAdminClient();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(EXAMS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      if (uploadError.message.includes("Bucket") || uploadError.message.includes("not found")) {
        return {
          success: false,
          error:
            `Bucket '${EXAMS_BUCKET}' não encontrado no Supabase Storage. Crie o bucket (público para leitura) para usar a Pasta de Exames.`,
        };
      }
      return {
        success: false,
        error: `Falha no upload: ${uploadError.message}`,
      };
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(EXAMS_BUCKET)
      .getPublicUrl(objectPath);

    const exam = await prisma.patientExam.create({
      data: {
        patientId,
        title,
        fileUrl: publicUrlData.publicUrl,
        fileType: mimeType,
        source: "MANUAL_UPLOAD",
      },
    });

    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${patientId}`);

    return { success: true, exam };
  } catch (error) {
    console.error("[uploadPatientExam]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao enviar exame.",
    };
  }
}

/**
 * Remove registro e arquivo no Storage (quando a URL pertence ao bucket configurado).
 */
export async function deletePatientExam(examId: string): Promise<DeletePatientExamResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }

    if (
      !canAccessPatientDocumentsTab(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer
      )
    ) {
      return {
        success: false,
        error: "Acesso à pasta de documentos não disponível.",
      };
    }

    const exam = await prisma.patientExam.findFirst({
      where: { id: examId },
      include: {
        patient: { select: { userId: true, id: true, ownerId: true, isShared: true } },
      },
    });

    if (!exam || exam.patient.userId !== dbUser.id) {
      return { success: false, error: "Exame não encontrado ou acesso negado." };
    }

    // Segregação Intra User: MEMBER só remove exames de pacientes no seu escopo.
    if (!(await assertPatientOwned(exam.patient.id, dbUser.id))) {
      return { success: false, error: "Exame não encontrado ou acesso negado." };
    }

    const objectPath = storageObjectPathFromPublicUrl(exam.fileUrl);
    if (objectPath) {
      const supabaseAdmin = createSupabaseAdminClient();
      const { error: removeError } = await supabaseAdmin.storage
        .from(EXAMS_BUCKET)
        .remove([objectPath]);
      if (removeError) {
        console.warn("[deletePatientExam] Storage remove:", removeError.message);
      }
    }

    await prisma.patientExam.delete({ where: { id: examId } });

    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${exam.patient.id}`);

    return { success: true };
  } catch (error) {
    console.error("[deletePatientExam]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao remover exame.",
    };
  }
}

/**
 * Grava PDF gerado por IA na pasta do paciente (Storage + PatientExam).
 * Chamado apenas a partir de server actions autenticadas (ex.: generateClinicalDocument).
 */
export async function createAiGeneratedPatientExam(params: {
  patientId: string;
  pdfBuffer: Buffer;
  title: string;
  documentType: string;
}): Promise<UploadPatientExamResult> {
  try {
    const dbUser = await getDbUserWithPlan();
    if (!dbUser) {
      return { success: false, error: "Usuário não autenticado." };
    }
    if (
      !canAccessPatientDocumentsTab(
        dbUser.plan,
        dbUser.email,
        dbUser.isInfluencer
      )
    ) {
      return { success: false, error: "Acesso à pasta de documentos negado." };
    }
    if (!(await assertPatientOwned(params.patientId, dbUser.id))) {
      return { success: false, error: "Paciente não encontrado ou acesso negado." };
    }

    const buf = params.pdfBuffer;
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
      return { success: false, error: "PDF inválido ou muito grande (máx. 8 MB)." };
    }

    const safeTitle = params.title.replace(/[^\w\-]/g, "_").replace(/_+/g, "_").slice(0, 120);
    const objectPath = `${dbUser.id}/${params.patientId}/ai-doc-${Date.now()}-${safeTitle || "documento"}.pdf`;

    const supabaseAdmin = createSupabaseAdminClient();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(EXAMS_BUCKET)
      .upload(objectPath, buf, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return {
        success: false,
        error: `Falha no upload: ${uploadError.message}`,
      };
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(EXAMS_BUCKET)
      .getPublicUrl(objectPath);

    const exam = await prisma.patientExam.create({
      data: {
        patientId: params.patientId,
        title: params.title.slice(0, 200),
        fileUrl: publicUrlData.publicUrl,
        fileType: "application/pdf",
        source: "AI_GENERATED",
        documentType: params.documentType.slice(0, 80),
      },
    });

    revalidatePath("/dashboard/patients");
    revalidatePath(`/dashboard/patients/${params.patientId}`);

    return { success: true, exam };
  } catch (error) {
    console.error("[createAiGeneratedPatientExam]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao gravar documento.",
    };
  }
}
