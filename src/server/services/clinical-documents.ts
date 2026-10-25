import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedContext } from "@/lib/auth/session-user";
import { resolveSessionEmail, BASICO_AI_DOCUMENTS_PER_MONTH, isBasicoPlanForDocumentQuota } from "@/lib/plan-limits";
import {
  CLINICAL_DOCUMENT_TYPE_KEYS,
  CLINICAL_DOCUMENT_TYPE_LABELS,
  isClinicalDocumentTypeKey,
  type ClinicalDocumentTypeKey,
} from "@/lib/clinical-document-types";
import { generateClinicalDocumentCore } from "@/server/services/clinical-documents-generate";
import type { DocumentsUserContext } from "@/server/services/clinical-documents-generate";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import {
  buildPatientScopeWhere,
  scopedPatientWhereOrEmpty,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";

export type { DocumentsUserContext };

export function buildDocumentsUserContext(ctx: AuthenticatedContext): DocumentsUserContext {
  return {
    id: ctx.dbUser.id,
    plan: ctx.dbUser.plan,
    email: ctx.dbUser.email,
    sessionEmail: ctx.email,
    isInfluencer: ctx.dbUser.isInfluencer,
    name: ctx.dbUser.name,
  };
}

function startEndUtcMonth(d = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { start, end };
}

export type DocumentQuotaPayload = {
  plan: string | null;
  usedThisMonth: number;
  limitThisMonth: number | null;
  unlimited: boolean;
};

export async function getDocumentGenerationQuotaForUser(
  user: DocumentsUserContext,
): Promise<DocumentQuotaPayload> {
  const { start, end } = startEndUtcMonth();
  const used = await prisma.patientExam.count({
    where: {
      source: "AI_GENERATED",
      patient: { userId: user.id },
      createdAt: { gte: start, lte: end },
    },
  });
  const free = isBasicoPlanForDocumentQuota(user.plan, user.sessionEmail, user.isInfluencer);
  return {
    plan: user.plan,
    usedThisMonth: used,
    limitThisMonth: free ? BASICO_AI_DOCUMENTS_PER_MONTH : null,
    unlimited: !free,
  };
}

export type UserTemplateSummary = {
  id: string;
  documentType: string;
  label: string | null;
  fileUrl: string;
  fileType: string;
  createdAt: string;
};

export async function listUserDocumentTemplatesForUser(
  userId: string,
): Promise<UserTemplateSummary[]> {
  const rows = await prisma.userDocumentTemplate.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    documentType: r.documentType,
    label: r.label,
    fileUrl: r.fileUrl,
    fileType: r.fileType,
    createdAt: r.createdAt.toISOString(),
  }));
}

export function listClinicalDocumentTypesForApi() {
  return CLINICAL_DOCUMENT_TYPE_KEYS.map((key) => ({
    key,
    label: CLINICAL_DOCUMENT_TYPE_LABELS[key],
  }));
}

export const GenerateClinicalDocumentInputSchema = z
  .object({
    patientId: z.string().uuid(),
    documentType: z.string(),
    destinationEmail: z.string().max(320).default(""),
    transcription: z.string().min(10).max(120_000),
    professionalName: z.string().max(200).optional(),
    profession: z.string().max(120).optional(),
    councilType: z.string().max(80).optional(),
    councilNumber: z.string().max(80).optional(),
    officeAddress: z.string().max(500).optional(),
    phone: z.string().max(40).optional(),
    professionalEmail: z.union([z.string().email(), z.literal("")]).optional(),
    logo: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const em = data.destinationEmail.trim();
    if (em.length > 0 && !z.string().email().safeParse(em).success) {
      ctx.addIssue({
        code: "custom",
        message: "E-mail inválido.",
        path: ["destinationEmail"],
      });
    }
  });

export type GenerateClinicalDocumentResult = Awaited<
  ReturnType<typeof generateClinicalDocumentForUser>
>;

export async function generateClinicalDocumentForUser(
  user: DocumentsUserContext,
  raw: unknown,
  options?: { activeIntraUser?: ActiveIntraUser | null },
) {
  const parsed = GenerateClinicalDocumentInputSchema.safeParse(raw);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.find((i) => i.path.includes("destinationEmail"));
    return {
      success: false as const,
      error: emailIssue?.message || "Dados inválidos.",
    };
  }

  if (!isClinicalDocumentTypeKey(parsed.data.documentType)) {
    return { success: false as const, error: "Tipo de documento inválido." };
  }

  if (isBasicoPlanForDocumentQuota(user.plan, user.sessionEmail, user.isInfluencer)) {
    const { start, end } = startEndUtcMonth();
    const used = await prisma.patientExam.count({
      where: {
        source: "AI_GENERATED",
        patient: { userId: user.id },
        createdAt: { gte: start, lte: end },
      },
    });
    if (used >= BASICO_AI_DOCUMENTS_PER_MONTH) {
      return {
        success: false as const,
        quotaExceeded: true,
        error: `Limite do plano BASICO: ${BASICO_AI_DOCUMENTS_PER_MONTH} documentos por IA por mês (UTC).`,
      };
    }
  }

  // API v1 passa activeIntraUser; web resolve do cookie. Sem perfil → fail-closed.
  const scopeWhere =
    options?.activeIntraUser !== undefined
      ? buildPatientScopeWhere({
          tenantId: user.id,
          activeIntraUser: options.activeIntraUser,
        })
      : scopedPatientWhereOrEmpty(user.id, await getPatientAccessScope());
  const owned = await prisma.patient.findFirst({
    where: { ...scopeWhere, id: parsed.data.patientId },
    select: { id: true },
  });
  if (!owned) {
    return { success: false as const, error: "Paciente não encontrado." };
  }

  return generateClinicalDocumentCore(user, {
    ...parsed.data,
    documentType: parsed.data.documentType as ClinicalDocumentTypeKey,
  });
}

export type { ClinicalDocumentTypeKey };
