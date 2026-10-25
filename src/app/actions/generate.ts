"use server";

import { sendEvolutionEmail } from "@/lib/email";
import { saveEvolution } from "./patient";
import { persistEvolutionExamAttachmentsSilently } from "./patient-exams";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { formatMedicationsAndSupplementsForDocument } from "@/lib/evolution-artifacts";

export interface GeneratePDFResult {
  success: boolean;
  pdfBase64?: string;
  pdfUrl?: string;
  fileName?: string;
  emailSent?: boolean;
  /** Preferência do usuário: baixar PDF no dispositivo após gerar. */
  shouldDownloadPdf?: boolean;
  /** Preferência do usuário: enviar PDF por e-mail (pode falhar mesmo se true). */
  shouldEmailPdf?: boolean;
  evolutionSaved?: boolean;
  evolutionId?: string;
  patientId?: string;
  /** Erro ao salvar evolução (ex: limite atingido) — frontend pode mostrar UpgradeModal */
  evolutionError?: string;
  error?: string;
  /** Baixa automática da próxima sessão do plano ativo (se houver). */
  sessionConsumption?: import("@/lib/finance/evolution-session-consumption").EvolutionSessionConsumptionSummary;
}

interface PatientData {
  nome: string;
  idade: string;
  queixa: string;
  diagnostico: string;
  conduta: string;
  dataAtendimento: string;
  dataNascimento?: string;
  transcription: string;
  examsAnalysis?: string; // Análise de exames complementares (separada)
  telefone?: string;
  nomePai?: string;
  nomeMae?: string;
  nomeAcompanhante?: string;
  telefoneAcompanhante?: string;
  professionalName?: string;
  profession?: string;
  councilType?: string;
  councilNumber?: string;
  officeAddress?: string;
  phone?: string;
  email?: string;
  logo?: string | null;
  linkedPatientId?: string; // ID do paciente existente para vincular (detecção de similares)
  appointmentId?: string;
  /** Anexos da Nova Evolução — persistidos na pasta PRO do paciente após salvar (best-effort). */
  examAttachments?: { base64: string; mimeType: string; fileName: string }[];
  clinicalMeta?: Record<string, string | undefined>;
  professionalActions?: import("@/lib/evolution-artifacts").ProfessionalActionsStored;
  patientHandout?: import("@/lib/evolution-artifacts").PatientHandoutStored;
  medicationsAndSupplements?: import("@/lib/evolution-artifacts").MedicationsAndSupplementsStored;
  /** Adia onEvolutionRecorded — consumo virá do createPatientPurchase. */
  deferAutomaticSessionConsumption?: boolean;
}

/**
 * Server Action para gerar PDF da evolução e retornar como base64
 * @param patientData Dados do paciente e evolução
 */
export async function generatePDF(
  patientData: PatientData
): Promise<GeneratePDFResult> {
  try {
    // Dados do profissional + preferências de entrega (selects separados:
    // prefs não podem derrubar o PDF nem forçar download/e-mail se o client estiver desatualizado).
    let userFromDb: {
      name: string | null;
      profession: string | null;
      councilType: string | null;
      councilNumber: string | null;
      email: string | null;
    } | null = null;
    let shouldDownloadPdf = true;
    let shouldEmailPdf = true;

    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.email) {
        userFromDb = await prisma.user.findUnique({
          where: { email: authUser.email },
          select: {
            name: true,
            profession: true,
            councilType: true,
            councilNumber: true,
            email: true,
          },
        });

        try {
          const prefs = await prisma.user.findUnique({
            where: { email: authUser.email },
            select: {
              autoDownloadNewEvolution: true,
              emailNewEvolution: true,
            },
          });
          if (prefs) {
            shouldDownloadPdf = prefs.autoDownloadNewEvolution;
            shouldEmailPdf = prefs.emailNewEvolution;
          }
        } catch (prefsError) {
          // Client/DB desatualizado: fail-closed nas vias opcionais (não reenviar contra a vontade).
          shouldDownloadPdf = false;
          shouldEmailPdf = false;
          console.warn(
            "[generatePDF] Preferências de entrega indisponíveis; download/e-mail desativados nesta geração.",
            prefsError instanceof Error ? prefsError.message : prefsError,
          );
        }
      }
    } catch (e) {
      // Ignorar erros de autenticação - dados do profissional virão do formulário
    }

    // Bundle ES (browser) — package "jspdf" no servidor resolve para jspdf.node.min.js → fflate Worker que o Turbopack não empacota
    const { default: jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPosition = margin;

    // Título Principal - Evolução Clínica (sem cabeçalho Louzada Entregas)
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("EVOLUÇÃO CLÍNICA", pageWidth / 2, yPosition, { align: "center" });
    
    yPosition += 8;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Data: ${patientData.dataAtendimento}`, pageWidth / 2, yPosition, { align: "center" });
    
    yPosition += 10;
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    // Caixa de Identificação
    const boxStartY = yPosition;
    yPosition += 5;
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("IDENTIFICAÇÃO DO PACIENTE", margin + 5, yPosition);
    yPosition += 7;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Nome: ${patientData.nome}`, margin + 5, yPosition);
    yPosition += 6;
    doc.text(`Idade: ${patientData.idade}`, margin + 5, yPosition);
    yPosition += 6;
    doc.text(`Data do Atendimento: ${patientData.dataAtendimento}`, margin + 5, yPosition);
    
    yPosition += 5;
    const boxEndY = yPosition;
    
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(margin, boxStartY, pageWidth - 2 * margin, boxEndY - boxStartY);
    
    yPosition += 10;

    // Altura disponível antes do rodapé
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerMargin = 60; // Espaço para rodapé (50px do rodapé + 10px de margem)
    const maxY = pageHeight - footerMargin;

    // Função para adicionar texto com paginação automática
    const addTextWithPagination = (title: string, content: string, isBold = false) => {
      if (!content || content.trim() === "") return;

      // Verificar se precisa de nova página para o título
      if (yPosition + 15 > maxY) {
        doc.addPage();
        yPosition = margin;
      }

      // Adicionar título
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(title, margin, yPosition);
      yPosition += 7;

      // Preparar texto (remover markdown se houver)
      const cleanContent = content
        .replace(/\*\*/g, "") // Remove negrito **
        .replace(/#{1,6}\s/g, "") // Remove títulos #
        .replace(/##\s/g, "") // Remove títulos ##
        .trim();

      doc.setFontSize(10);
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      
      // Dividir texto em linhas que cabem na página
      const splitText = doc.splitTextToSize(cleanContent, pageWidth - 2 * margin);
      
      // Adicionar texto linha por linha, verificando paginação
      for (const line of splitText) {
        // Verificar se precisa de nova página
        if (yPosition + 6 > maxY) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5; // Espaçamento entre linhas
      }
      
      yPosition += 5; // Espaço após o texto
    };

    // Seções iniciais
    addTextWithPagination("QUEIXA PRINCIPAL", patientData.queixa);
    addTextWithPagination("DIAGNÓSTICO", patientData.diagnostico);
    addTextWithPagination("CONDUTA", patientData.conduta);
    
    // Descrição do Atendimento (evolução clínica detalhada)
    if (patientData.transcription) {
      addTextWithPagination("DESCRIÇÃO DO ATENDIMENTO", patientData.transcription);
    }

    // Exames Complementares (separado, se houver)
    if (patientData.examsAnalysis && patientData.examsAnalysis.trim() !== "") {
      // Verificar espaço: se não couber título + pelo menos um pouco de texto, nova página
      if (yPosition + 20 > maxY) {
        doc.addPage();
        yPosition = margin;
      }

      // Título em destaque
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 100, 200); // Cor azul para destacar
      doc.text("EXAMES COMPLEMENTARES", margin, yPosition);
      yPosition += 7;

      // Texto dos exames
      const cleanExamsText = patientData.examsAnalysis
        .replace(/\*\*/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/##\s/g, "")
        .trim();

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0); // Voltar cor preta
      
      const splitExamsText = doc.splitTextToSize(cleanExamsText, pageWidth - 2 * margin);
      
      for (const line of splitExamsText) {
        if (yPosition + 6 > maxY) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      }
      
      yPosition += 5;
    }

    // Medicamentos & Suplementos (secção destacada, como exames)
    const medsDocText = formatMedicationsAndSupplementsForDocument(
      patientData.medicationsAndSupplements,
    );
    if (medsDocText) {
      if (yPosition + 20 > maxY) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(16, 110, 100); // Teal clínico — distinto do azul de exames
      doc.text("MEDICAMENTOS E SUPLEMENTOS", margin, yPosition);
      yPosition += 7;

      const cleanMedsText = medsDocText
        .replace(/\*\*/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/##\s/g, "")
        .trim();

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      const splitMedsText = doc.splitTextToSize(cleanMedsText, pageWidth - 2 * margin);

      for (const line of splitMedsText) {
        if (yPosition + 6 > maxY) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      }

      yPosition += 5;
    }

    // Rodapé - Dados do Profissional (sempre no final da última página)
    // Garantir que há espaço suficiente, se não, criar nova página
    if (yPosition + 40 > pageHeight - footerMargin) {
      doc.addPage();
      yPosition = margin;
    }
    
    // Posicionar rodapé no final da página atual
    yPosition = pageHeight - footerMargin;
    doc.setLineWidth(0.3);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Dados do Profissional:", margin, yPosition);
    yPosition += 10;

    // Adicionar dados do profissional (prioridade: dados do formulário > banco > fallback)
    const professionalName =
      patientData.professionalName ||
      userFromDb?.name ||
      "Doutor(a)";
    const profession =
      patientData.profession || userFromDb?.profession || "";
    const councilType =
      patientData.councilType || userFromDb?.councilType || "";
    const councilNumber =
      patientData.councilNumber || userFromDb?.councilNumber || "";
    const email = patientData.email || userFromDb?.email || "";

    doc.text(`Nome: ${professionalName}`, margin, yPosition);
    yPosition += 6;

    if (profession) {
      doc.text(`Profissão: ${profession}`, margin, yPosition);
      yPosition += 6;
    }

    if (councilType && councilNumber) {
      doc.text(`${councilType}: ${councilNumber}`, margin, yPosition);
      yPosition += 6;
    }

    if (patientData.officeAddress) {
      doc.text(`Local: ${patientData.officeAddress}`, margin, yPosition);
      yPosition += 6;
    }

    if (patientData.phone) {
      doc.text(`Contato: ${patientData.phone}`, margin, yPosition);
      yPosition += 6;
    }

    if (email) {
      doc.text(`E-mail: ${email}`, margin, yPosition);
      yPosition += 6;
    }

    // Adicionar logo no canto inferior direito (se houver)
    if (patientData.logo) {
      try {
        const logoStartY = doc.internal.pageSize.getHeight() - 50 + 8; // Mesma altura dos dados do profissional
        const logoSize = 30; // 30mm
        const logoX = pageWidth - margin - logoSize; // Alinhado à direita
        
        // jsPDF aceita data URLs diretamente
        // Determinar o formato da imagem pela data URL
        let imageFormat = 'PNG';
        if (patientData.logo.startsWith('data:image/jpeg') || patientData.logo.startsWith('data:image/jpg')) {
          imageFormat = 'JPEG';
        } else if (patientData.logo.startsWith('data:image/png')) {
          imageFormat = 'PNG';
        }
        
        // Extrair apenas a parte base64 da data URL
        const base64Data = patientData.logo.split(',')[1];
        
        doc.addImage(base64Data, imageFormat, logoX, logoStartY, logoSize, logoSize);
      } catch (error) {
        console.error("Erro ao adicionar logo no PDF:", error);
        // Não falhar a geração do PDF se a logo tiver problema
      }
    }

    // Converter PDF para base64 e buffer
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const fileName = `${patientData.dataAtendimento.replace(/\//g, '-')} - ${patientData.nome}.pdf`;

    // Enviar email apenas se a preferência estiver ativa e houver destinatário
    let emailSent = false;
    const emailRecipient = (patientData.email || userFromDb?.email || "").trim();
    if (shouldEmailPdf && emailRecipient) {
      console.log("📄 [PDF] Preferência de e-mail ativa, iniciando envio...");
      try {
        const emailResult = await sendEvolutionEmail(
          emailRecipient,
          pdfBuffer,
          professionalName
        );
        emailSent = emailResult.success;
        if (emailResult.success) {
          console.log("✅ [PDF] Email enviado com sucesso!");
        } else {
          console.error("❌ [PDF] Falha ao enviar email:", emailResult.error);
        }
      } catch (error) {
        console.error("❌ [PDF] ERRO ao enviar email (catch):", error);
        if (error instanceof Error) {
          console.error("❌ [PDF] Mensagem:", error.message);
        }
        // Não falhar a geração do PDF se o email falhar - continua o fluxo
        emailSent = false;
      }
    } else if (!shouldEmailPdf) {
      console.log("ℹ️ [PDF] Envio por e-mail desativado nas preferências do perfil.");
    } else {
      console.log("ℹ️ [PDF] Nenhum email fornecido, pulando envio.");
    }

    // Salvar evolução no banco de dados (se houver nome do paciente)
    let evolutionSaved = false;
    let evolutionId: string | undefined;
    let savedPatientId: string | undefined;
    let evolutionError: string | undefined;
    let sessionConsumption: GeneratePDFResult["sessionConsumption"];
    let pdfUrl: string | undefined = undefined;
    
    if (patientData.nome && patientData.nome.trim() !== "") {
      try {
        console.log("💾 [PDF] Salvando evolução no banco...");
        
        // Tentar fazer upload do PDF para o Supabase Storage (usando admin client para bypass de RLS)
        try {
          const supabaseAdmin = createSupabaseAdminClient();
          const supabase = await createSupabaseServerClient();
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          const userId = currentUser?.email?.replace(/[^a-zA-Z0-9]/g, '_') || 'anonymous';
          const timestamp = Date.now();
          const safeFileName = `${userId}/${timestamp}-${patientData.nome.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
          
          console.log(`📤 [PDF] Iniciando upload: ${safeFileName}`);
          
          const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('evolutions')
            .upload(safeFileName, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: false,
            });
          
          if (uploadError) {
            console.error("❌ [PDF] Erro no upload do PDF:", uploadError.message, uploadError);
          } else if (uploadData) {
            const { data: publicUrlData } = supabaseAdmin.storage
              .from('evolutions')
              .getPublicUrl(safeFileName);
            
            pdfUrl = publicUrlData.publicUrl;
            console.log(`✅ [PDF] PDF salvo no storage: ${pdfUrl}`);
          }
        } catch (uploadError) {
          console.error("❌ [PDF] Erro ao fazer upload do PDF:", uploadError);
          // Continuar mesmo sem o upload - o PDF será baixado mas não ficará no storage
        }
        
        const saveResult = await saveEvolution({
          patientName: patientData.nome,
          patientAge: patientData.idade || undefined,
          patientDateOfBirth: patientData.dataNascimento || undefined,
          patientDiagnosis: patientData.diagnostico || undefined,
          telefone: patientData.telefone || undefined,
          nomePai: patientData.nomePai || undefined,
          nomeMae: patientData.nomeMae || undefined,
          nomeAcompanhante: patientData.nomeAcompanhante || undefined,
          telefoneAcompanhante: patientData.telefoneAcompanhante || undefined,
          patientQueixa: patientData.queixa || undefined,
          patientConduta: patientData.conduta || undefined,
          attendanceDate: patientData.dataAtendimento || undefined,
          content: patientData.transcription,
          examsAnalysis: patientData.examsAnalysis || undefined,
          pdfUrl: pdfUrl,
          linkedPatientId: patientData.linkedPatientId,
          appointmentId: patientData.appointmentId,
          clinicalMeta: patientData.clinicalMeta,
          professionalActions: patientData.professionalActions,
          patientHandout: patientData.patientHandout,
          medicationsAndSupplements: patientData.medicationsAndSupplements,
          deferAutomaticSessionConsumption:
            patientData.deferAutomaticSessionConsumption === true,
        });
        
        if (saveResult.success) {
          evolutionSaved = true;
          evolutionId = saveResult.evolutionId;
          savedPatientId = saveResult.patientId;
          sessionConsumption = saveResult.sessionConsumption;
          console.log(`✅ [PDF] Evolução salva! ID: ${saveResult.evolutionId}`);
          if (saveResult.isNewPatient) {
            console.log(`✅ [PDF] Novo paciente criado: ${patientData.nome}`);
          }
          if (
            saveResult.patientId &&
            patientData.examAttachments &&
            patientData.examAttachments.length > 0
          ) {
            try {
              await persistEvolutionExamAttachmentsSilently(
                saveResult.patientId,
                patientData.examAttachments
              );
            } catch {
              /* pasta PRO / storage: não interromper fluxo */
            }
          }
        } else {
          console.warn("⚠️ [PDF] Falha ao salvar evolução:", saveResult.error);
          evolutionError = saveResult.error;
        }
      } catch (saveError) {
        console.error("❌ [PDF] Erro ao salvar evolução:", saveError);
        // Não falhar a geração do PDF se o salvamento falhar
      }
    } else {
      console.log("ℹ️ [PDF] Nome do paciente não informado, evolução não será salva no histórico.");
    }

    return {
      success: true,
      pdfBase64,
      pdfUrl,
      fileName,
      emailSent,
      shouldDownloadPdf,
      shouldEmailPdf,
      evolutionSaved,
      evolutionId,
      patientId: savedPatientId,
      evolutionError,
      sessionConsumption,
    };
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao gerar PDF",
    };
  }
}

