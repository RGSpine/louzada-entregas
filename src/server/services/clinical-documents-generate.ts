import { prisma } from "@/lib/prisma";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import { getGeminiModel, generateContentSafe } from "@/lib/gemini";
import { sanitizeText } from "@/lib/sanitize";
import { sendGeneratedDocumentEmail } from "@/lib/email";
import {
  CLINICAL_DOCUMENT_TYPE_LABELS,
  getClinicalDocumentPromptPack,
  pdfTitleForDocumentType,
  type ClinicalDocumentTypeKey,
} from "@/lib/clinical-document-types";
import { createAiGeneratedPatientExam } from "@/app/actions/patient-exams";
import { buildPatientExamShareUrl } from "@/lib/document-share-link";

export type DocumentsUserContext = {
  id: string;
  plan: string | null;
  email: string | null;
  sessionEmail: string | null;
  isInfluencer: boolean;
  name: string | null;
};

type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

const MAX_TEMPLATE_BYTES = 6 * 1024 * 1024;

const ALLOWED_TEMPLATE_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const LEADING_PATIENT_IDENTIFICATION =
  /^IDENTIFICAÇÃO DO PACIENTE\s*\r?\n+\s*Nome:\s*[^\r\n]+\r?\n\s*Idade:\s*[^\r\n]+\s*(?:\r?\n)+/i;

function stripLeadingPatientIdentificationBlock(text: string): string {
  return text.replace(LEADING_PATIENT_IDENTIFICATION, "").trimStart();
}

function patientAgeLabel(age: string | null | undefined): string {
  const t = age?.trim();
  return t && t.length > 0 ? t : "não informada";
}

function withCanonicalPatientIdentification(
  bodyText: string,
  patient: { name: string; age: string | null },
): string {
  const cleaned = stripLeadingPatientIdentificationBlock(bodyText);
  const header = `IDENTIFICAÇÃO DO PACIENTE\nNome: ${patient.name}\nIdade: ${patientAgeLabel(patient.age)}`;
  return cleaned.length > 0 ? `${header}\n\n${cleaned}` : header;
}

async function fetchInlinePartForUrl(url: string): Promise<GeminiContentPart | null> {
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

type GenerateInput = {
  patientId: string;
  documentType: ClinicalDocumentTypeKey;
  destinationEmail: string;
  transcription: string;
  professionalName?: string;
  profession?: string;
  councilType?: string;
  councilNumber?: string;
  officeAddress?: string;
  phone?: string;
  professionalEmail?: string;
  logo?: string | null;
};

export async function generateClinicalDocumentCore(
  user: DocumentsUserContext,
  data: GenerateInput,
) {
  try {
    const docType = data.documentType;

    const patient = await prisma.patient.findFirst({
      where: { id: data.patientId, userId: user.id },
      select: { name: true, age: true, diagnosis: true },
    });
    if (!patient) {
      return { success: false as const, error: "Paciente não encontrado." };
    }

    const templates = await prisma.userDocumentTemplate.findMany({
      where: { userId: user.id, documentType: docType },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    const pack = getClinicalDocumentPromptPack(docType);
    const typeLabel = CLINICAL_DOCUMENT_TYPE_LABELS[docType];
    const transcription = sanitizeText(data.transcription);

    let templateHint = "";
    if (templates.length > 0) {
      templateHint = templates
        .map(
          (t, i) =>
            `Referência ${i + 1} (rótulo: ${t.label || "sem rótulo"}): use o ficheiro como guia de apresentação apenas quando o rascunho abaixo for incompleto. Se o rascunho já for um texto corrido completo e revisado, NÃO substitua o seu teor nem a ordem das informações pela estrutura do modelo — limite-se a pequenos ajustes de forma.`,
        )
        .join("\n");
    }

    const diagnosisContext = patient.diagnosis
      ? `- Diagnóstico registrado: ${patient.diagnosis} (INCLUA APENAS se for clinicamente relevante ao conteúdo do documento abaixo; caso contrário, omita completamente)`
      : "";

    const patientContextBlock =
      docType === "RECIBO"
        ? `Tipo RECIBO: não inclua nome nem idade do paciente no documento. Use apenas o rascunho abaixo.\n`
        : `Contexto do paciente (nome e idade oficiais vão no cabeçalho fixo do PDF; não repita esse bloco na tua resposta):
- Nome: ${patient.name}
- Idade: ${patientAgeLabel(patient.age)}
${diagnosisContext ? `${diagnosisContext}\n` : ""}`;

    const userPrompt = `Corpo do documento clínico (tipo no menu: ${typeLabel}). O título oficial (${typeLabel}) e o rodapé com dados do profissional são impressos pelo sistema — NÃO os duplique nem altere no texto abaixo.

SOBERANIA DO TEXTO-BASE (obrigatório):
O seguinte bloco é o rascunho definitivo escrito/revisado pelo profissional na aplicação. Ele é SOBERANO: a sua saída deve ser esse texto, no mesmo fio narrativo, preservando nomes, documentos, valores, datas e formulações salvo correções ortográficas ou gramaticais mínimas. É PROIBIDO reescrever por estilo, resumir, trocar ordem de frases ou alterar a voz do discurso (ex.: não transformar "eu, Fulano, declaro que recebi..." em "Declaro que recebi de Fulano..."). Se o rascunho já está correto, copie-o quase literalmente.

${pack}

${patientContextBlock}
--- RASCUNHO SOBERANO (reproduzir no PDF como corpo, sem o título do tipo) ---
${transcription}
--- FIM DO RASCUNHO ---

${templateHint ? `Modelos de referência (subordinados ao rascunho):\n${templateHint}\n` : ""}

REGRAS OBRIGATÓRIAS (violação = erro):
1. Responda APENAS com o texto do corpo em português brasileiro (o que irá entre o título central do PDF e o rodapé automático).
2. Proibido markdown (asteriscos, cerquilhas, hifens como bullet, crases triplas).
3. NÃO inclua data no corpo (a data é inserida automaticamente no rodapé do PDF).
4. NÃO inclua bloco de assinatura, nome/conselho/número do profissional (o rodapé do PDF já contém esses dados).
5. NÃO inclua saudações de encerramento ("Atenciosamente", "Cordialmente", etc).
6. NÃO invente dados que não estejam no rascunho.
7. NÃO escreva "CONTEÚDO DO DOCUMENTO", nem rótulos soltos "PACIENTE" ou "IDADE" no topo (exceto quando o pacote do tipo exigir IDENTIFICAÇÃO DO PACIENTE e o rascunho ainda não a tiver).
8. Para RECIBO: nenhuma identificação do utente como "paciente" por idade; siga o rascunho. Para os demais tipos: se o rascunho não trouxer IDENTIFICAÇÃO DO PACIENTE, comece conforme o pacote; se o rascunho já a trouxer, mantenha-a como está.`;

    const parts: GeminiContentPart[] = [{ text: userPrompt }];
    const templateParts = await Promise.all(
      templates.slice(0, 2).map((t) => fetchInlinePartForUrl(t.fileUrl)),
    );
    for (const p of templateParts) {
      if (p) parts.push(p);
    }

    const model = getGeminiModel();
    const result = await generateContentSafe(model, parts, 90_000, 1);
    let bodyText = sanitizeText(result.response.text()).trim();
    if (!bodyText || bodyText.length < 20) {
      return { success: false as const, error: "A IA não devolveu conteúdo suficiente." };
    }
    if (docType !== "RECIBO") {
      bodyText = withCanonicalPatientIdentification(bodyText, patient);
    }

    const dateLabel = new Date().toLocaleDateString("pt-BR");
    const pdfTitle = pdfTitleForDocumentType(docType);

    const pdfBuffer = await buildClinicalDocumentPdf({
      documentTitle: pdfTitle,
      bodyText,
      dateLabel,
      professionalName: data.professionalName?.trim() || user.name || "Profissional",
      profession: data.profession?.trim() || "",
      councilType: data.councilType?.trim() || "",
      councilNumber: data.councilNumber?.trim() || "",
      officeAddress: data.officeAddress?.trim() || "",
      phone: data.phone?.trim() || "",
      professionalEmail: data.professionalEmail?.trim() || "",
      logo: data.logo,
    });

    const examTitle = `${typeLabel} — ${patient.name}`;
    const saveResult = await createAiGeneratedPatientExam({
      patientId: data.patientId,
      pdfBuffer,
      title: examTitle.slice(0, 200),
      documentType: docType,
    });
    if (!saveResult.success || !saveResult.exam) {
      return {
        success: false as const,
        error: saveResult.error || "Erro ao guardar documento na pasta do paciente.",
      };
    }

    const safeFile = `${typeLabel.replace(/\s+/g, "_")}-${patient.name.replace(/\s+/g, "_")}-${dateLabel.replace(/\//g, "-")}.pdf`
      .replace(/[^\w\-à-úÀ-Ú.]/g, "_")
      .slice(0, 180);

    const emailDest = data.destinationEmail.trim();
    const emailSubject = `Documento: ${typeLabel} — Louzada Entregas`;
    const emailProfName = data.professionalName?.trim() || user.name || undefined;
    let emailSent = false;
    if (emailDest) {
      emailSent = true;
      sendGeneratedDocumentEmail(
        emailDest,
        pdfBuffer,
        safeFile,
        emailSubject,
        emailProfName,
      ).catch((err) => console.error("[generateClinicalDocument] email async error:", err));
    }

    const shareUrl = buildPatientExamShareUrl(saveResult.exam.id) ?? undefined;

    return {
      success: true as const,
      pdfBase64: pdfBuffer.toString("base64"),
      fileName: safeFile,
      publicUrl: saveResult.exam.fileUrl,
      shareUrl,
      examId: saveResult.exam.id,
      emailSent,
      patientId: data.patientId,
    };
  } catch (e) {
    console.error("[generateClinicalDocumentCore]", e);
    return {
      success: false as const,
      error: formatAiProviderErrorForUser(e),
    };
  }
}
