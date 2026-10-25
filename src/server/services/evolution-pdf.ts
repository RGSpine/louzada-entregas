import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  formatMedicationsAndSupplementsForDocument,
  medicationsAndSupplementsStoredSchema,
} from "@/lib/evolution-artifacts";
import { resolveClinicLogoForPdf } from "@/lib/pdf-clinic-logo";

export const GenerateEvolutionPdfSchema = z.object({
  patientName: z.string().trim().min(1).max(200),
  patientAge: z.string().max(40).optional(),
  patientDiagnosis: z.string().max(2000).optional(),
  attendanceDate: z.string().max(30).optional(),
  queixa: z.string().max(50_000).optional(),
  diagnostico: z.string().max(50_000).optional(),
  conduta: z.string().max(50_000).optional(),
  content: z.string().trim().min(1).max(200_000),
  examsAnalysis: z.string().max(100_000).optional(),
  medicationsAndSupplements: medicationsAndSupplementsStoredSchema.optional(),
  /** Ex.: "Importada de Nura" — não altera o layout das evoluções nativas. */
  originNote: z.string().max(120).optional(),
});

export type GenerateEvolutionPdfInput = z.infer<typeof GenerateEvolutionPdfSchema>;

type ProfessionalContext = {
  name: string | null;
  profession: string | null;
  councilType: string | null;
  councilNumber: string | null;
  officeAddress: string | null;
  phone: string | null;
  email: string | null;
  clinicLogoUrl: string | null;
};

export type GenerateEvolutionPdfResult =
  | { success: true; pdfBase64: string; fileName: string }
  | { success: false; error: string };

async function loadProfessionalContext(dbUserId: string): Promise<ProfessionalContext | null> {
  return prisma.user.findUnique({
    where: { id: dbUserId },
    select: {
      name: true,
      profession: true,
      councilType: true,
      councilNumber: true,
      officeAddress: true,
      phone: true,
      email: true,
      clinicLogoUrl: true,
    },
  });
}

/** Gera PDF de evolução clínica (sem salvar no banco) — espelha layout web. */
export async function generateEvolutionPdfForUser(
  dbUserId: string,
  input: GenerateEvolutionPdfInput,
): Promise<GenerateEvolutionPdfResult> {
  try {
    const professional = await loadProfessionalContext(dbUserId);
    if (!professional) {
      return { success: false, error: "Usuário não encontrado." };
    }

    const dataAtendimento = input.attendanceDate?.trim() || new Date().toLocaleDateString("pt-BR");
    const clinicLogo = await resolveClinicLogoForPdf(professional.clinicLogoUrl);
    const { default: jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPosition = margin;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("EVOLUÇÃO CLÍNICA", pageWidth / 2, yPosition, { align: "center" });
    yPosition += 8;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Data: ${dataAtendimento}`, pageWidth / 2, yPosition, { align: "center" });
    if (input.originNote?.trim()) {
      yPosition += 6;
      doc.setFontSize(9);
      doc.text(input.originNote.trim(), pageWidth / 2, yPosition, { align: "center" });
      doc.setFontSize(10);
    }
    yPosition += 10;
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    const boxStartY = yPosition;
    yPosition += 5;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("IDENTIFICAÇÃO DO PACIENTE", margin + 5, yPosition);
    yPosition += 7;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Nome: ${input.patientName}`, margin + 5, yPosition);
    yPosition += 6;
    if (input.patientAge) {
      doc.text(`Idade: ${input.patientAge}`, margin + 5, yPosition);
      yPosition += 6;
    }
    doc.text(`Data do Atendimento: ${dataAtendimento}`, margin + 5, yPosition);
    yPosition += 5;
    doc.rect(margin, boxStartY, pageWidth - 2 * margin, yPosition - boxStartY);
    yPosition += 10;

    const pageHeight = doc.internal.pageSize.getHeight();
    const footerMargin = 60;
    const maxY = pageHeight - footerMargin;

    const addTextWithPagination = (title: string, content: string) => {
      if (!content?.trim()) return;
      if (yPosition + 15 > maxY) {
        doc.addPage();
        yPosition = margin;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(title, margin, yPosition);
      yPosition += 7;
      const cleanContent = content.replace(/\*\*/g, "").replace(/#{1,6}\s/g, "").trim();
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const splitText = doc.splitTextToSize(cleanContent, pageWidth - 2 * margin);
      for (const line of splitText) {
        if (yPosition + 6 > maxY) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      }
      yPosition += 5;
    };

    addTextWithPagination("QUEIXA PRINCIPAL", input.queixa ?? "");
    addTextWithPagination("DIAGNÓSTICO", input.diagnostico ?? input.patientDiagnosis ?? "");
    addTextWithPagination("CONDUTA", input.conduta ?? "");
    addTextWithPagination("DESCRIÇÃO DO ATENDIMENTO", input.content);
    if (input.examsAnalysis?.trim()) {
      addTextWithPagination("EXAMES COMPLEMENTARES", input.examsAnalysis);
    }
    const medsDocText = formatMedicationsAndSupplementsForDocument(
      input.medicationsAndSupplements,
    );
    if (medsDocText) {
      addTextWithPagination("MEDICAMENTOS E SUPLEMENTOS", medsDocText);
    }

    if (yPosition + 40 > pageHeight - footerMargin) {
      doc.addPage();
      yPosition = margin;
    }
    yPosition = pageHeight - footerMargin;
    doc.setLineWidth(0.3);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;
    doc.setFontSize(9);
    doc.text("Dados do Profissional:", margin, yPosition);
    yPosition += 10;

    const professionalName = professional.name || "Doutor(a)";
    doc.text(`Nome: ${professionalName}`, margin, yPosition);
    yPosition += 6;
    if (professional.profession) {
      doc.text(`Profissão: ${professional.profession}`, margin, yPosition);
      yPosition += 6;
    }
    if (professional.councilType && professional.councilNumber) {
      doc.text(`${professional.councilType}: ${professional.councilNumber}`, margin, yPosition);
      yPosition += 6;
    }
    if (professional.officeAddress) {
      doc.text(`Local: ${professional.officeAddress}`, margin, yPosition);
      yPosition += 6;
    }
    if (professional.phone) {
      doc.text(`Contato: ${professional.phone}`, margin, yPosition);
      yPosition += 6;
    }
    if (professional.email) {
      doc.text(`E-mail: ${professional.email}`, margin, yPosition);
    }

    if (clinicLogo) {
      try {
        const logoSize = 30;
        const logoX = pageWidth - margin - logoSize;
        const logoY = pageHeight - 50 + 8;
        doc.addImage(clinicLogo.data, clinicLogo.format, logoX, logoY, logoSize, logoSize);
      } catch (logoError) {
        console.error("[evolution-pdf] logo:", logoError);
      }
    }

    const pdfBase64 = doc.output("datauristring").split(",")[1] ?? "";
    const safeDate = dataAtendimento.replace(/\//g, "-");
    const fileName = `${safeDate} - ${input.patientName}.pdf`;

    return { success: true, pdfBase64, fileName };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao gerar PDF.",
    };
  }
}
