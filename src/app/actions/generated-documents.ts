"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import type { Part } from "@google/generative-ai";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import { getGeminiFastModel, getGeminiModel, generateContentSafe } from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";
import { sendGeneratedDocumentEmail } from "@/lib/email";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { headers } from "next/headers";
import {
  BASICO_AI_DOCUMENTS_PER_MONTH,
  isBasicoPlanForDocumentQuota,
  resolveSessionEmail,
} from "@/lib/plan-limits";
import { getPatientAccessScope } from "@/lib/intra-user/patient-access";
import {
  buildPatientScopeWhere,
  scopedPatientWhereOrEmpty,
  type ActiveIntraUser,
} from "@/lib/intra-user/patient-scope";
import {
  CLINICAL_DOCUMENT_TYPE_LABELS,
  documentTypeSupportsEvolutionClinicalSummary,
  getClinicalDocumentPromptPack,
  getEvolutionAssistStructureHint,
  getEvolutionClinicalSummaryFormatInstructions,
  isClinicalDocumentTypeKey,
  isEvolutionAssistDocumentType,
  pdfTitleForDocumentType,
  type ClinicalDocumentTypeKey,
} from "@/lib/clinical-document-types";
import { createAiGeneratedPatientExam } from "@/app/actions/patient-exams";
import { buildPatientExamShareUrl } from "@/lib/document-share-link";

/** Partes de conteúdo aceites por `generateContent` (evita depender do export `Part` do SDK). */
type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

const EXAMS_BUCKET = "patient-exams";
const MAX_TEMPLATE_BYTES = 6 * 1024 * 1024;
const MAX_TEMPLATES_PER_USER = 25;

/** Rascunho «curto»: acima disto, «Revisar com IA» mantém só revisão ortográfica (sem garimpar evoluções). */
const REVISE_SHORT_DRAFT_MAX_CHARS = 560;
const EVOLUTION_ASSIST_MAX_ROWS = 12;
const EVOLUTION_ASSIST_MAX_CHARS_PER_ROW = 3200;
const EVOLUTION_ASSIST_TOTAL_BUDGET = 26000;

/** Resumo clínico a partir de evoluções (botão na página gerar documento). */
const EXTRACT_SUMMARY_MAX_ROWS = 18;
const EXTRACT_SUMMARY_MAX_CHARS_PER_ROW = 3500;
const EXTRACT_SUMMARY_TOTAL_BUDGET = 45000;

const ALLOWED_TEMPLATE_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Remove bloco inicial duplicado se a IA o incluir na mesma forma canónica. */
const LEADING_PATIENT_IDENTIFICATION =
  /^IDENTIFICAÇÃO DO PACIENTE\s*\r?\n+\s*Nome:\s*[^\r\n]+\r?\n\s*Idade:\s*[^\r\n]+\s*(?:\r?\n)+/i;

function stripLeadingPatientIdentificationBlock(text: string): string {
  return text.replace(LEADING_PATIENT_IDENTIFICATION, "").trimStart();
}

function patientAgeLabel(age: string | null | undefined): string {
  const t = age?.trim();
  return t && t.length > 0 ? t : "não informada";
}

/** Prefixo fixo no PDF com dados da ficha (todos os tipos exceto RECIBO). */
function withCanonicalPatientIdentification(
  bodyText: string,
  patient: { name: string; age: string | null }
): string {
  const cleaned = stripLeadingPatientIdentificationBlock(bodyText);
  const header = `IDENTIFICAÇÃO DO PACIENTE\nNome: ${patient.name}\nIdade: ${patientAgeLabel(patient.age)}`;
  return cleaned.length > 0 ? `${header}\n\n${cleaned}` : header;
}

function startEndUtcMonth(d = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  return { start, end };
}

async function getDbUserForDocs() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser) return null;
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ authUserId: authUser.id }, { email: authUser.email ?? "" }],
    },
    select: {
      id: true,
      plan: true,
      email: true,
      isInfluencer: true,
      name: true,
    },
  });
  if (!dbUser) return null;
  return {
    ...dbUser,
    sessionEmail: resolveSessionEmail(authUser.email, dbUser.email),
  };
}

async function assertPatientOwnedByUser(
  patientId: string,
  userId: string,
  activeIntraUser?: ActiveIntraUser | null,
): Promise<boolean> {
  const where =
    activeIntraUser !== undefined
      ? buildPatientScopeWhere({ tenantId: userId, activeIntraUser })
      : scopedPatientWhereOrEmpty(userId, await getPatientAccessScope());
  const p = await prisma.patient.findFirst({
    where: { ...where, id: patientId },
    select: { id: true },
  });
  return !!p;
}

export interface DocumentQuotaResult {
  success: boolean;
  plan?: string | null;
  usedThisMonth?: number;
  limitThisMonth?: number | null;
  unlimited?: boolean;
  error?: string;
}

export async function getDocumentGenerationQuota(): Promise<DocumentQuotaResult> {
  try {
    const u = await getDbUserForDocs();
    if (!u) return { success: false, error: "Não autenticado." };
    const { getDocumentGenerationQuotaForUser } = await import(
      "@/server/services/clinical-documents"
    );
    const quota = await getDocumentGenerationQuotaForUser({
      id: u.id,
      plan: u.plan,
      email: u.email,
      sessionEmail: u.sessionEmail,
      isInfluencer: u.isInfluencer,
      name: u.name,
    });
    return {
      success: true,
      plan: quota.plan,
      usedThisMonth: quota.usedThisMonth,
      limitThisMonth: quota.limitThisMonth,
      unlimited: quota.unlimited,
    };
  } catch (e) {
    console.error("[getDocumentGenerationQuota]", e);
    return { success: false, error: "Erro ao consultar quota." };
  }
}

export interface UserTemplateSummary {
  id: string;
  documentType: string;
  label: string | null;
  fileUrl: string;
  fileType: string;
  createdAt: string;
}

export async function listUserDocumentTemplates(): Promise<{
  success: boolean;
  templates?: UserTemplateSummary[];
  error?: string;
}> {
  try {
    const u = await getDbUserForDocs();
    if (!u) return { success: false, error: "Não autenticado." };
    const { listUserDocumentTemplatesForUser } = await import(
      "@/server/services/clinical-documents"
    );
    const templates = await listUserDocumentTemplatesForUser(u.id);
    return { success: true, templates };
  } catch (e) {
    console.error("[listUserDocumentTemplates]", e);
    return { success: false, error: "Erro ao listar modelos." };
  }
}

function sanitizeTemplateFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return base.length > 0 ? base : "modelo";
}

export async function uploadUserDocumentTemplate(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const u = await getDbUserForDocs();
    if (!u) return { success: false, error: "Não autenticado." };

    const count = await prisma.userDocumentTemplate.count({
      where: { userId: u.id },
    });
    if (count >= MAX_TEMPLATES_PER_USER) {
      return {
        success: false,
        error: `Limite de ${MAX_TEMPLATES_PER_USER} modelos por utilizador.`,
      };
    }

    const docTypeRaw = formData.get("documentType");
    const labelRaw = formData.get("label");
    const file = formData.get("file");

    const parsed = z
      .object({
        documentType: z.string(),
        label: z.string().max(200).optional(),
      })
      .safeParse({
        documentType: typeof docTypeRaw === "string" ? docTypeRaw : "",
        label: typeof labelRaw === "string" ? labelRaw : undefined,
      });

    if (!parsed.success || !isClinicalDocumentTypeKey(parsed.data.documentType)) {
      return { success: false, error: "Tipo de documento inválido." };
    }

    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "Selecione um ficheiro." };
    }
    if (file.size > MAX_TEMPLATE_BYTES) {
      return { success: false, error: "Ficheiro muito grande (máx. 6 MB)." };
    }
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_TEMPLATE_MIME.has(mime)) {
      return {
        success: false,
        error: "Use PDF ou imagem (JPEG, PNG, WebP).",
      };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitizeTemplateFileName(file.name || "modelo");
    const objectPath = `${u.id}/templates/${Date.now()}-${safeName}`;

    const admin = createSupabaseAdminClient();
    const { error: upErr } = await admin.storage
      .from(EXAMS_BUCKET)
      .upload(objectPath, buffer, { contentType: mime, upsert: false });
    if (upErr) {
      return { success: false, error: `Falha no upload: ${upErr.message}` };
    }
    const { data: pub } = admin.storage.from(EXAMS_BUCKET).getPublicUrl(objectPath);

    const labelClean = parsed.data.label?.trim()
      ? sanitizeText(parsed.data.label.trim()).slice(0, 200)
      : null;

    await prisma.userDocumentTemplate.create({
      data: {
        userId: u.id,
        documentType: parsed.data.documentType,
        label: labelClean,
        fileUrl: pub.publicUrl,
        fileType: mime,
      },
    });

    revalidatePath("/dashboard/generate-document");
    return { success: true };
  } catch (e) {
    console.error("[uploadUserDocumentTemplate]", e);
    return { success: false, error: "Erro ao guardar modelo." };
  }
}

export async function deleteUserDocumentTemplate(
  templateId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const u = await getDbUserForDocs();
    if (!u) return { success: false, error: "Não autenticado." };
    const row = await prisma.userDocumentTemplate.findFirst({
      where: { id: templateId, userId: u.id },
    });
    if (!row) return { success: false, error: "Modelo não encontrado." };

    const marker = `/object/public/${EXAMS_BUCKET}/`;
    const idx = row.fileUrl.indexOf(marker);
    if (idx !== -1) {
      const objectPath = decodeURIComponent(
        row.fileUrl.slice(idx + marker.length)
      );
      const admin = createSupabaseAdminClient();
      await admin.storage.from(EXAMS_BUCKET).remove([objectPath]);
    }

    await prisma.userDocumentTemplate.delete({ where: { id: templateId } });
    revalidatePath("/dashboard/generate-document");
    return { success: true };
  } catch (e) {
    console.error("[deleteUserDocumentTemplate]", e);
    return { success: false, error: "Erro ao remover modelo." };
  }
}

async function fetchInlinePartForUrl(
  url: string
): Promise<GeminiContentPart | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    if (!ALLOWED_TEMPLATE_MIME.has(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_TEMPLATE_BYTES) return null;
    return {
      inlineData: { mimeType: mime, data: buf.toString("base64") },
    };
  } catch {
    return null;
  }
}

async function buildClinicalDocumentPdf(opts: {
  documentTitle: string;
  bodyText: string;
  dateLabel: string;
  professionalName: string;
  profession: string;
  councilType: string;
  councilNumber: string;
  officeAddress: string;
  phone: string;
  professionalEmail: string;
  logo: string | null | undefined;
}): Promise<Buffer> {
  const { default: jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = margin;
  const footerMargin = 55;
  const maxY = pageHeight - footerMargin;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(opts.documentTitle, pageWidth / 2, y, { align: "center" });
  y += 10;
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  const body = sanitizeText(opts.bodyText).trim();
  if (body) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const split = doc.splitTextToSize(body, pageWidth - 2 * margin);
    for (const line of split) {
      if (y + 6 > maxY) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 5;
    }
    y += 6;
  }

  y = Math.max(y, pageHeight - footerMargin);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Data: ${opts.dateLabel}`, margin, y);
  y += 7;
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFontSize(9);
  doc.text("Profissional responsável:", margin, y);
  y += 6;
  doc.text(`Nome: ${opts.professionalName}`, margin, y);
  y += 5;
  if (opts.profession) {
    doc.text(`Profissão: ${opts.profession}`, margin, y);
    y += 5;
  }
  if (opts.councilType && opts.councilNumber) {
    doc.text(`${opts.councilType}: ${opts.councilNumber}`, margin, y);
    y += 5;
  }
  if (opts.officeAddress) {
    doc.text(`Local: ${opts.officeAddress}`, margin, y);
    y += 5;
  }
  if (opts.phone) {
    doc.text(`Contato: ${opts.phone}`, margin, y);
    y += 5;
  }
  if (opts.professionalEmail) {
    doc.text(`E-mail: ${opts.professionalEmail}`, margin, y);
    y += 5;
  }

  if (opts.logo?.startsWith("data:image")) {
    try {
      const logoY = pageHeight - 42;
      const logoX = pageWidth - margin - 28;
      let fmt: "PNG" | "JPEG" = "PNG";
      if (opts.logo.includes("jpeg") || opts.logo.includes("jpg")) fmt = "JPEG";
      const b64 = opts.logo.split(",")[1];
      if (b64) doc.addImage(b64, fmt, logoX, logoY, 28, 28);
    } catch {
      /* ignore */
    }
  }

  const pdfBase64 = doc.output("datauristring").split(",")[1];
  return Buffer.from(pdfBase64, "base64");
}

const GenerateClinicalDocumentSchema = z
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

export interface GenerateClinicalDocumentResult {
  success: boolean;
  pdfBase64?: string;
  fileName?: string;
  publicUrl?: string;
  /** Link curto no domínio da app (`/api/document-share`) quando `DOCUMENT_SHARE_LINK_SECRET` está definido. */
  shareUrl?: string;
  examId?: string;
  emailSent?: boolean;
  error?: string;
  quotaExceeded?: boolean;
}

export async function generateClinicalDocument(
  raw: unknown
): Promise<GenerateClinicalDocumentResult> {
  try {
    const u = await getDbUserForDocs();
    if (!u) return { success: false, error: "Não autenticado." };

    const emailKey = u.sessionEmail || u.id;
    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: emailKey.toLowerCase(),
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return {
        success: false,
        error: aiBillingRateLimitMessage(rl.resetIn),
      };
    }

    const { generateClinicalDocumentForUser } = await import(
      "@/server/services/clinical-documents"
    );
    const result = await generateClinicalDocumentForUser(
      {
        id: u.id,
        plan: u.plan,
        email: u.email,
        sessionEmail: u.sessionEmail,
        isInfluencer: u.isInfluencer,
        name: u.name,
      },
      raw,
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        quotaExceeded: "quotaExceeded" in result ? result.quotaExceeded : undefined,
      };
    }

    revalidatePath("/dashboard/patients");
    if ("patientId" in result && result.patientId) {
      revalidatePath(`/dashboard/patients/${result.patientId}`);
    }

    return {
      success: true,
      pdfBase64: result.pdfBase64,
      fileName: result.fileName,
      publicUrl: result.publicUrl,
      shareUrl: result.shareUrl,
      examId: result.examId,
      emailSent: result.emailSent,
    };
  } catch (e) {
    console.error("[generateClinicalDocument]", e);
    return {
      success: false,
      error: formatAiProviderErrorForUser(e),
    };
  }
}

function contentHasMergeEnrichmentSections(text: string): boolean {
  return (
    /---\s*Exames\s*\/\s*anexos\s*---/i.test(text) ||
    /---\s*Informa[cç][oô]es adicionais\s*\(\s*[áa]udio\s*\)\s*---/i.test(text)
  );
}

const ReviseClinicalDocumentDraftSchema = z.object({
  content: z.string().min(1).max(200_000),
  documentType: z.string(),
  patientId: z.string().uuid().optional(),
  /** Sinalização do cliente: texto já inclui secções de áudio/anexos processados. */
  hasMergedAudioOrFileSections: z.boolean().optional(),
});

/**
 * Revisão do rascunho com IA: modelos de referência → Pro multimodal; rascunho curto + paciente + tipo elegível → Pro com evoluções;
 * caso contrário Flash (só texto) ou gramática mínima.
 */
export async function reviseClinicalDocumentDraft(
  raw: unknown,
  userOverride?: {
    id: string;
    plan: string | null;
    email: string | null;
    sessionEmail: string | null;
    isInfluencer: boolean;
    name: string | null;
  },
  options?: { activeIntraUser?: ActiveIntraUser | null },
): Promise<
  { body: string; usedEvolutionContext?: boolean } | { error: string }
> {
  try {
    const u = userOverride ?? (await getDbUserForDocs());
    if (!u) return { error: "Não autenticado." };

    const key = u.sessionEmail || u.id;
    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: key.toLowerCase(),
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return {
        error: aiBillingRateLimitMessage(rl.resetIn),
      };
    }

    const parsed = ReviseClinicalDocumentDraftSchema.safeParse(raw);
    if (!parsed.success) {
      return { error: "Dados inválidos." };
    }
    const { content, documentType, patientId, hasMergedAudioOrFileSections } = parsed.data;
    if (!isClinicalDocumentTypeKey(documentType)) {
      return { error: "Tipo de documento inválido." };
    }

    const typeLabel = CLINICAL_DOCUMENT_TYPE_LABELS[documentType];

    const templates = await prisma.userDocumentTemplate.findMany({
      where: { userId: u.id, documentType },
      orderBy: { createdAt: "desc" },
      take: 2,
    });

    const templateHint =
      templates.length > 0
        ? `Seguem ${templates.length} ficheiro(s) de MODELO DE REFERENCIA (PDF ou imagem) para alinhar estrutura, tom e formalidade. Use-os como guia estilistica; NAO copie dados identificadores de terceiros dos modelos. O rascunho abaixo e a unica fonte de dados deste doente.`
        : "";

    const hasVisualRef = templates.length > 0;
    const hasMergeEnrichment =
      hasMergedAudioOrFileSections === true || contentHasMergeEnrichmentSections(content);
    const shortDraft =
      content.trim().length > 0 && content.trim().length <= REVISE_SHORT_DRAFT_MAX_CHARS;

    const tryEvolutionAssist =
      !hasVisualRef &&
      !hasMergeEnrichment &&
      shortDraft &&
      Boolean(patientId) &&
      isEvolutionAssistDocumentType(documentType);

    if (tryEvolutionAssist && patientId) {
      const owned = await assertPatientOwnedByUser(
        patientId,
        u.id,
        options?.activeIntraUser,
      );
      if (owned) {
        const patient = await prisma.patient.findFirst({
          where: { id: patientId, userId: u.id },
          select: { name: true, age: true, diagnosis: true },
        });
        if (patient) {
          const evRows = await prisma.evolution.findMany({
            where: { patientId, patient: { userId: u.id } },
            orderBy: { date: "desc" },
            take: EVOLUTION_ASSIST_MAX_ROWS,
            select: { content: true, date: true, tags: true },
          });

          let budget = EVOLUTION_ASSIST_TOTAL_BUDGET;
          const chunks: string[] = [];
          for (const ev of evRows) {
            const rawEvo = (ev.content || "").trim();
            if (!rawEvo) continue;
            const cleaned = sanitizeText(rawEvo).slice(0, EVOLUTION_ASSIST_MAX_CHARS_PER_ROW);
            if (!cleaned) continue;
            const dateStr = ev.date.toLocaleDateString("pt-BR");
            const tagStr =
              ev.tags && ev.tags.length > 0
                ? ` Tags: ${ev.tags.slice(0, 8).join(", ")}.`
                : "";
            const header = `--- Evolução ${dateStr}.${tagStr} ---\n`;
            const room = budget - header.length;
            if (room < 80) break;
            const bodySlice = cleaned.length <= room ? cleaned : cleaned.slice(0, room);
            chunks.push(header + bodySlice);
            budget -= header.length + bodySlice.length;
            if (budget < 80) break;
          }
          const evolutionContextBlock =
            chunks.join("\n\n") ||
            "(Sem texto registado nas evoluções — use só a frase do utilizador e a ficha.)";

          const diag = patient.diagnosis?.trim();
          const agePart = patient.age?.trim() || "não informada";
          const structureHint = getEvolutionAssistStructureHint(documentType);

          const userBlockEvo = `Tipo de documento (menu): ${typeLabel}.
Objectivo: o utilizador escreveu um rascunho MUITO CURTO. Expanda para um texto-base útil para gerar o PDF deste tipo, usando APENAS factos presentes na ficha, nas evoluções abaixo e na frase do utilizador.

Ficha do doente:
- Nome: ${patient.name}
- Idade: ${agePart}
${diag ? `- Diagnóstico registado na ficha: ${diag}` : ""}

Evoluções recentes (da mais recente para a mais antiga). Relacione com a intenção do utilizador (região, queixa, exame pedido, etc.) apenas quando houver suporte no texto.
${evolutionContextBlock}

Orientação de estrutura: ${structureHint}

Regras obrigatórias:
1. Não invente dados clínicos, datas de episódios, valores de exames ou diagnósticos que não constem nas evoluções, na ficha ou na frase.
2. Português brasileiro formal; SEM markdown; sem data no corpo; sem assinatura; sem saudações finais.
3. Sintetize com profissionalismo; não copie notas brutas sem organização.
4. Se não houver ligação clara nas evoluções, mantenha o pedido explícito da frase e acrescente só o que a ficha permitir (ex.: contexto diagnóstico) sem forçar laudo completo.
5. Responda APENAS com o texto expandido do rascunho (corpo do futuro documento), sem JSON e sem comentários.

FRASE / RASCUNHO DO UTILIZADOR:
${content}`;

          const systemInstructionEvo =
            "Voce e um assistente clinico que prepara rascunhos de documentos formais a partir de evolucoes do prontuario. Nao invente informacao. Resposta: somente o texto em portugues brasileiro.";

          const evoModel = getGeminiModel({ systemInstruction: systemInstructionEvo });
          const evoResult = await generateContentSafe(evoModel, userBlockEvo, 90_000, 1);
          const evoBody = sanitizeText(evoResult.response.text()).trim();
          if (!evoBody) {
            return { error: formatAiProviderErrorForUser("Resposta vazia da IA") };
          }
          return { body: evoBody, usedEvolutionContext: true };
        }
      }
    }

    const userBlock = `Documento (tipo no menu): ${typeLabel}.
${templateHint}

Regras:
1. Corrija gramatica e terminologia medica em portugues brasileiro.
2. Mantenha todos os factos do rascunho; nao adicione dados clinicos novos.
3. Responda APENAS com o texto revisado, sem markdown, sem JSON, sem comentarios.

RASCUNHO:
${content}`;

    const parts: GeminiContentPart[] = [{ text: userBlock }];
    for (const t of templates) {
      const p = await fetchInlinePartForUrl(t.fileUrl);
      if (p) parts.push(p);
    }

    const hasVisualRefParts = parts.length > 1;
    const systemInstruction = hasVisualRefParts
      ? `Voce revisa documentos clinicos. Ha modelos de referencia em anexo alem do texto. Siga o primeiro bloco de instrucoes. Resposta: somente o texto revisado em portugues brasileiro, sem markdown.`
      : `Voce e um assistente especializado em documentos clinicos formais em portugues brasileiro.
Revise o texto: corrija gramatica e terminologia, mantenha todos os fatos, nao adicione dados clinicos novos.
Responda APENAS com o texto revisado, sem markdown, sem JSON, sem comentarios.`;

    const model = hasVisualRefParts
      ? getGeminiModel({ systemInstruction })
      : getGeminiFastModel({ systemInstruction });

    const result = await generateContentSafe(
      model,
      parts as Part[],
      hasVisualRefParts ? 90_000 : 45_000,
      1
    );
    const body = sanitizeText(result.response.text()).trim();
    if (!body) {
      return { error: formatAiProviderErrorForUser("Resposta vazia da IA") };
    }
    return { body };
  } catch (e) {
    console.error("[reviseClinicalDocumentDraft]", e);
    return { error: formatAiProviderErrorForUser(e) };
  }
}

const ExtractClinicalSummaryFromEvolutionsSchema = z.object({
  patientId: z.string().uuid(),
  documentType: z.string(),
});

/**
 * Gera texto-base a partir das evoluções do paciente, com estrutura alinhada ao tipo de documento.
 */
export async function extractClinicalSummaryFromPatientEvolutions(
  raw: unknown,
  userOverride?: {
    id: string;
    plan: string | null;
    email: string | null;
    sessionEmail: string | null;
    isInfluencer: boolean;
    name: string | null;
  },
  options?: { activeIntraUser?: ActiveIntraUser | null },
): Promise<{ body: string } | { error: string }> {
  try {
    const u = userOverride ?? (await getDbUserForDocs());
    if (!u) return { error: "Não autenticado." };

    const key = u.sessionEmail || u.id;
    const hdrs = await headers();
    const rl = await enforceAiBillingRateLimit({
      userKey: key.toLowerCase(),
      ip: getRequestClientIp(hdrs),
    });
    if (!rl.allowed) {
      return {
        error: aiBillingRateLimitMessage(rl.resetIn),
      };
    }

    const parsed = ExtractClinicalSummaryFromEvolutionsSchema.safeParse(raw);
    if (!parsed.success) return { error: "Dados inválidos." };

    const { patientId, documentType } = parsed.data;
    if (!isClinicalDocumentTypeKey(documentType)) {
      return { error: "Tipo de documento inválido." };
    }
    const docType: ClinicalDocumentTypeKey = documentType;

    if (!documentTypeSupportsEvolutionClinicalSummary(docType)) {
      return {
        error:
          "Recibo não usa resumo clínico das evoluções. Escolha outro tipo de documento ou escreva o texto manualmente.",
      };
    }

    const formatBlock = getEvolutionClinicalSummaryFormatInstructions(docType);
    if (!formatBlock) {
      return { error: "Tipo de documento não suporta este resumo." };
    }

    if (!(await assertPatientOwnedByUser(patientId, u.id, options?.activeIntraUser))) {
      return { error: "Paciente não encontrado." };
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId: u.id },
      select: { name: true, age: true, diagnosis: true },
    });
    if (!patient) return { error: "Paciente não encontrado." };

    const evRows = await prisma.evolution.findMany({
      where: { patientId, patient: { userId: u.id } },
      orderBy: { date: "desc" },
      take: EXTRACT_SUMMARY_MAX_ROWS,
      select: { content: true, date: true, tags: true },
    });

    let budget = EXTRACT_SUMMARY_TOTAL_BUDGET;
    const chunks: string[] = [];
    for (const ev of evRows) {
      const rawEvo = (ev.content || "").trim();
      if (!rawEvo) continue;
      const cleaned = sanitizeText(rawEvo).slice(0, EXTRACT_SUMMARY_MAX_CHARS_PER_ROW);
      if (!cleaned) continue;
      const dateStr = ev.date.toLocaleDateString("pt-BR");
      const tagStr =
        ev.tags && ev.tags.length > 0
          ? ` Tags: ${ev.tags.slice(0, 8).join(", ")}.`
          : "";
      const header = `--- Evolução ${dateStr}.${tagStr} ---\n`;
      const room = budget - header.length;
      if (room < 80) break;
      const bodySlice = cleaned.length <= room ? cleaned : cleaned.slice(0, room);
      chunks.push(header + bodySlice);
      budget -= header.length + bodySlice.length;
      if (budget < 80) break;
    }

    const evolutionContextBlock =
      chunks.join("\n\n") || "(Nenhuma evolução com texto registado.)";

    const typeLabel = CLINICAL_DOCUMENT_TYPE_LABELS[docType];
    const diag = patient.diagnosis?.trim();
    const agePart = patient.age?.trim() || "não informada";

    const userBlock = `Tipo de documento pretendido no formulário: ${typeLabel}.

FORMATO E CONTEÚDO QUE O RASCUNHO DEVE SEGUIR:
${formatBlock}

Ficha (metadados — o sistema pode prefixar identificação no PDF; NÃO inclua no teu texto o bloco «IDENTIFICAÇÃO DO PACIENTE» nem rótulos soltos PACIENTE/IDADE no topo):
- Nome: ${patient.name}
- Idade: ${agePart}
${diag ? `- Diagnóstico registado na ficha: ${diag}` : ""}

EVOLUÇÕES (mais recente primeiro):
${evolutionContextBlock}

Tarefa: produza um único texto-base em português brasileiro para colar no formulário de geração de documento, seguindo o formato acima e usando apenas o que consta nas evoluções e na ficha.

Regras adicionais:
1. Sem markdown (proibido *, #, listas com hífen estilo markdown).
2. Não inclua data no texto; não inclua assinatura nem saudações finais.
3. Se não houver texto útil nas evoluções, devolva um parágrafo curto a informar que não há notas clínicas registadas para extrair — sem inventar caso clínico.`;

    const systemInstruction =
      "Voce e um assistente clinico que sintetiza evolucoes em rascunho para documento formal. Nao invente dados clinicos. Resposta: somente o texto em portugues brasileiro, sem markdown.";

    const model = getGeminiModel({ systemInstruction });
    const result = await generateContentSafe(model, userBlock, 90_000, 1);
    const body = sanitizeText(result.response.text()).trim();
    if (!body || body.length < 12) {
      return { error: "A IA não devolveu texto suficiente." };
    }
    return { body };
  } catch (e) {
    console.error("[extractClinicalSummaryFromPatientEvolutions]", e);
    return { error: formatAiProviderErrorForUser(e) };
  }
}
