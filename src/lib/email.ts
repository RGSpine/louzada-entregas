import nodemailer from "nodemailer";

/**
 * Envia um email com PDF anexado
 * @param to Email do destinatário
 * @param pdfBuffer Buffer do PDF
 * @param professionalName Nome do profissional (opcional)
 */
export async function sendEvolutionEmail(
  to: string,
  pdfBuffer: Buffer,
  professionalName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    // Log de debug: verificar credenciais
    console.log("📧 [EMAIL] Iniciando envio de email...");
    console.log("📧 [EMAIL] EMAIL_USER:", emailUser ? "✅ Configurado" : "❌ Não configurado");
    console.log("📧 [EMAIL] EMAIL_PASS:", emailPass ? "✅ Configurado" : "❌ Não configurado");
    console.log("📧 [EMAIL] Destinatário:", to);

    // Se não houver credenciais configuradas, apenas simular
    if (!emailUser || !emailPass) {
      console.log("⚠️ [EMAIL] Simulando envio de email (credenciais não configuradas)...");
      console.log(`📧 [EMAIL] Para: ${to}`);
      console.log(`📧 [EMAIL] Assunto: Sua Evolução Clínica - Louzada Entregas`);
      console.log(`📧 [EMAIL] Anexo: evolucao.pdf`);
      return { success: true };
    }

    // Criar transporter usando service: 'gmail' (resolve portas e secure automaticamente)
    console.log("📧 [EMAIL] Criando transporter com service: 'gmail'...");
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    // Mensagem cordial
    const greeting = professionalName ? `Olá, ${professionalName}` : "Olá";

    // Log antes de enviar
    console.log("📧 [EMAIL] Preparando email...");
    console.log("📧 [EMAIL] De:", emailUser);
    console.log("📧 [EMAIL] Para:", to);
    console.log("📧 [EMAIL] Assunto: Sua Evolução Clínica - Louzada Entregas");
    console.log("📧 [EMAIL] Tamanho do PDF:", pdfBuffer.length, "bytes");

    // Enviar email
    console.log("📧 [EMAIL] Enviando email...");
    const info = await transporter.sendMail({
      from: `"Louzada Entregas" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: "Sua Evolução Clínica - Louzada Entregas",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0ea5e9; margin-bottom: 20px;">Louzada Entregas</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #334155;">
            ${greeting},
          </p>
          <p style="font-size: 16px; line-height: 1.6; color: #334155;">
            Sua evolução clínica foi gerada com sucesso!
          </p>
          <p style="font-size: 16px; line-height: 1.6; color: #334155;">
            O arquivo PDF está anexado a este email para sua conveniência.
          </p>
          <p style="margin-top: 30px; font-size: 14px; color: #64748b;">
            Este é um email automático do sistema Louzada Entregas.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: "evolucao.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    console.log("✅ [EMAIL] Email enviado com sucesso!");
    console.log("✅ [EMAIL] Message ID:", info.messageId);
    console.log("✅ [EMAIL] Response:", info.response);
    return { success: true };
  } catch (error) {
    console.error("❌ [EMAIL] ERRO EMAIL:", error);
    if (error instanceof Error) {
      console.error("❌ [EMAIL] Mensagem:", error.message);
      console.error("❌ [EMAIL] Stack:", error.stack);
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao enviar email",
    };
  }
}

/**
 * Envia documento clínico gerado (PDF) para um e-mail de destino explícito
 * (não necessariamente o e-mail cadastrado do profissional).
 */
export async function sendGeneratedDocumentEmail(
  to: string,
  pdfBuffer: Buffer,
  fileName: string,
  subjectLine: string,
  professionalName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.log(
        "⚠️ [EMAIL DOC] Simulando envio (credenciais não configuradas). Destinatário:",
        to
      );
      return { success: true };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    const greeting = professionalName ? `Olá` : "Olá";
    const safeName =
      fileName.replace(/[^\w\s\-à-úÀ-Ú.]/g, "_").slice(0, 180) || "documento.pdf";

    await transporter.sendMail({
      from: `"Louzada Entregas" <${emailUser}>`,
      to,
      subject: subjectLine,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0ea5e9;">Louzada Entregas</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #334155;">
            ${greeting},
          </p>
          <p style="font-size: 16px; line-height: 1.6; color: #334155;">
            Segue em anexo o documento clínico solicitado.
          </p>
          <p style="margin-top: 24px; font-size: 14px; color: #64748b;">
            Documento gerado pela plataforma Louzada Entregas. Verifique o conteúdo antes de arquivar ou encaminhar.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: safeName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return { success: true };
  } catch (error) {
    console.error("❌ [EMAIL DOC]", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao enviar documento por e-mail",
    };
  }
}

/**
 * E-mail branded de recuperação de senha (remetente noreplyevoluai / EMAIL_USER).
 * O link deve apontar para o domínio da app com token_hash (não para /auth/v1/verify).
 */
export async function sendPasswordRecoveryEmail(
  to: string,
  recoveryLink: string,
  userName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error("[RECOVERY] EMAIL_USER / EMAIL_PASS não configurados");
      return { success: false, error: "Configuração de e-mail incompleta." };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    const greeting = userName?.trim() ? `Olá, ${userName.trim()}` : "Olá";
    const logoUrl = "http://localhost:3000/icons/icon-192.png";

    await transporter.sendMail({
      from: `"Louzada Entregas" <${emailUser}>`,
      to,
      subject: "Redefinir senha — Louzada Entregas",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #e7eef8;">
          <div style="background-color: #0f172a; padding: 28px; border-radius: 12px; text-align: center;">
            <img src="${logoUrl}" alt="Louzada Entregas" width="64" height="64" style="display: inline-block; border-radius: 12px; margin-bottom: 12px;" />
            <h1 style="color: #00008f; margin: 0 0 8px 0; font-size: 26px;">Louzada Entregas</h1>
            <p style="color: #94a3b8; margin: 0; font-size: 14px;">Evoluções clínicas inteligentes</p>
          </div>

          <div style="background-color: white; padding: 28px; border-radius: 12px; margin-top: 16px;">
            <p style="font-size: 18px; color: #1e293b; margin: 0 0 16px 0;">${greeting},</p>
            <p style="font-size: 16px; line-height: 1.65; color: #475569; margin: 0 0 20px 0;">
              Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo
              para abrir a página segura do Louzada Entregas. Na próxima tela, confirme com
              &quot;Continuar&quot; e escolha a nova senha. O link é de uso único.
            </p>

            <div style="text-align: center; margin: 28px 0;">
              <a href="${recoveryLink}"
                 style="display: inline-block; background-color: #00008f; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Redefinir minha senha
              </a>
            </div>

            <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0 0 12px 0;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="font-size: 12px; word-break: break-all; color: #94a3b8; margin: 0 0 20px 0;">
              ${recoveryLink}
            </p>

            <p style="font-size: 13px; color: #64748b; margin: 0;">
              Se você não solicitou esta alteração, ignore este e-mail. Sua senha permanece a mesma.
            </p>
          </div>

          <div style="text-align: center; padding: 16px; color: #94a3b8; font-size: 12px;">
            <p style="margin: 0;">Enviado por Louzada Entregas &lt;${emailUser}&gt;</p>
          </div>
        </div>
      `,
      text: `${greeting},\n\nPara redefinir sua senha no Louzada Entregas, abra este link (uso único):\n${recoveryLink}\n\nSe você não pediu isso, ignore este e-mail.`,
    });

    return { success: true };
  } catch (error) {
    console.error("[RECOVERY] Erro ao enviar e-mail:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao enviar e-mail",
    };
  }
}

/** E-mail para trocar o PIN do administrador principal. O link não revela o PIN atual. */
export async function sendAdminPinResetEmail(
  to: string,
  resetLink: string,
  userName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    if (!emailUser || !emailPass) {
      return { success: false, error: "Configuração de e-mail incompleta." };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });
    const greeting = userName?.trim() ? `Olá, ${userName.trim()}` : "Olá";

    await transporter.sendMail({
      from: `"Louzada Entregas" <${emailUser}>`,
      to,
      subject: "Trocar o PIN do administrador — Louzada Entregas",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #e7eef8;">
          <div style="background-color: #0f172a; padding: 28px; border-radius: 12px; text-align: center;">
            <h1 style="color: #00008f; margin: 0 0 8px 0; font-size: 26px;">Louzada Entregas</h1>
            <p style="color: #94a3b8; margin: 0; font-size: 14px;">Coletas e entregas do laboratório</p>
          </div>
          <div style="background-color: white; padding: 28px; border-radius: 12px; margin-top: 16px;">
            <p style="font-size: 18px; color: #1e293b; margin: 0 0 16px 0;">${greeting},</p>
            <p style="font-size: 16px; line-height: 1.65; color: #475569; margin: 0 0 20px 0;">
              Recebemos um pedido para trocar o PIN do administrador principal.
              O link vale por uma hora e só pode ser usado uma vez.
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${resetLink}"
                 style="display: inline-block; background-color: #00008f; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Trocar o PIN
              </a>
            </div>
            <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0 0 12px 0;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="font-size: 12px; word-break: break-all; color: #94a3b8; margin: 0 0 20px 0;">${resetLink}</p>
            <p style="font-size: 13px; color: #64748b; margin: 0;">
              Se você não solicitou esta troca, ignore este e-mail. O PIN atual continua valendo.
            </p>
          </div>
        </div>
      `,
      text: `${greeting},\n\nPara trocar o PIN do administrador no Louzada Entregas, abra este link (uso único, vale 1 hora):\n${resetLink}\n\nSe você não pediu isso, ignore este e-mail.`,
    });

    return { success: true };
  } catch (error) {
    console.error("[PIN RESET] Erro ao enviar e-mail:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao enviar e-mail",
    };
  }
}

/**
 * Envia um email de confirmação de cadastro
 * @param to Email do destinatário
 * @param confirmationLink Link de confirmação do Supabase
 * @param userName Nome do usuário (opcional)
 */
export async function sendConfirmationEmail(
  to: string,
  confirmationLink: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    console.log("📧 [CONFIRMATION] Iniciando envio de email de confirmação...");
    console.log("📧 [CONFIRMATION] Destinatário:", to);

    if (!emailUser || !emailPass) {
      console.error("❌ [CONFIRMATION] Credenciais de email não configuradas");
      return { success: false, error: "Configuração de email incompleta" };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    const greeting = userName ? `Olá, ${userName}` : "Olá";

    const info = await transporter.sendMail({
      from: `"Louzada Entregas" <${emailUser}>`,
      to: to,
      subject: "Confirme seu cadastro - Louzada Entregas",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #e7eef8;">
          <div style="background-color: #0f172a; padding: 30px; border-radius: 12px;">
            <h1 style="color: #00008f; margin: 0 0 10px 0; font-size: 28px;">Louzada Entregas</h1>
            <p style="color: #94a3b8; margin: 0; font-size: 14px;">Evoluções Clínicas Inteligentes</p>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 12px; margin-top: 20px;">
            <p style="font-size: 18px; color: #1e293b; margin: 0 0 20px 0;">
              ${greeting}! 👋
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #475569; margin: 0 0 25px 0;">
              Seu cadastro no Louzada Entregas foi realizado com sucesso! Para começar a usar a plataforma, confirme seu e-mail clicando no botão abaixo:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${confirmationLink}" 
                 style="display: inline-block; background-color: #00008f; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Confirmar meu e-mail
              </a>
            </div>
            
            <p style="font-size: 14px; color: #64748b; margin: 25px 0 0 0;">
              Se o botão não funcionar, copie e cole este link no seu navegador:
            </p>
            <p style="font-size: 12px; color: #00008f; word-break: break-all; margin: 10px 0 0 0;">
              ${confirmationLink}
            </p>
          </div>
          
          <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
            <p style="margin: 0;">Este é um email automático do Louzada Entregas.</p>
            <p style="margin: 5px 0 0 0;">Se você não solicitou este cadastro, ignore este email.</p>
          </div>
        </div>
      `,
    });

    console.log("✅ [CONFIRMATION] Email de confirmação enviado!");
    console.log("✅ [CONFIRMATION] Message ID:", info.messageId);
    return { success: true };
  } catch (error) {
    console.error("❌ [CONFIRMATION] Erro ao enviar email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao enviar email",
    };
  }
}

/** Notifica o SAC sobre pedido manual de integração Google Agenda (período de testes). */
export async function sendGoogleCalendarManualEnrollmentEmail(input: {
  professionalName: string;
  professionalEmail: string;
  professionalPlan: string;
  googleEmail: string;
  adminPhone: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const sacEmail = process.env.SAC_EMAIL;
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!sacEmail || !emailUser || !emailPass) {
      console.error(
        "[GCAL MANUAL] Variáveis de e-mail faltando (SAC_EMAIL, EMAIL_USER, EMAIL_PASS)",
      );
      return { success: false, error: "Sistema de notificação indisponível." };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    await transporter.sendMail({
      from: `"Louzada Entregas SAC" <${emailUser}>`,
      to: sacEmail,
      replyTo: input.professionalEmail,
      subject: `[Google Agenda] Cadastro manual — ${input.professionalName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background-color: #0f172a; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #00008f; margin: 0; font-size: 22px;">Louzada Entregas — Google Agenda</h1>
            <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Pedido de cadastro manual (período de testes)</p>
          </div>
          <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 28px; border-radius: 0 0 12px 12px;">
            <p style="font-size: 15px; color: #1e293b; margin: 0 0 16px 0;">
              Um profissional solicitou a ligação manual com o Google Agenda.
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">Profissional:</td>
                <td style="padding: 6px 0; color: #1e293b; font-weight: 600;">${input.professionalName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">E-mail na plataforma:</td>
                <td style="padding: 6px 0; color: #1e293b;">${input.professionalEmail}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">Plano:</td>
                <td style="padding: 6px 0; color: #1e293b;">${input.professionalPlan}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">E-mail Google (cadastro):</td>
                <td style="padding: 6px 0; color: #1e293b; font-weight: 600;">${input.googleEmail}</td>
              </tr>
            </table>
            <p style="margin-top: 20px; font-size: 13px; color: #64748b;">
              WhatsApp admin: ${input.adminPhone}
            </p>
            <p style="margin-top: 16px; font-size: 13px; color: #64748b;">
              Após concluir o OAuth manual, defina <code>google_calendar_manual_approved_at</code> no utilizador para liberar o botão «Conectar Google».
            </p>
          </div>
        </div>
      `,
    });

    return { success: true };
  } catch (error) {
    console.error("❌ [GCAL MANUAL]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao notificar SAC",
    };
  }
}

export type LegacyFreeSunsetEmailParams = {
  userName?: string | null;
  monthlyPrice: string;
  annualPerMonth: string;
  trialDays: number;
  graceDays: number;
};

/** E-mail transacional: transição do gratuito legado para o Plano Básico pago. */
export async function sendLegacyFreeSunsetEmail(
  to: string,
  upgradeUrl: string,
  params: LegacyFreeSunsetEmailParams,
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error("[LEGACY SUNSET] EMAIL_USER / EMAIL_PASS não configurados");
      return { success: false, error: "Configuração de e-mail incompleta." };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    const greeting = params.userName?.trim() ? `Olá, ${params.userName.trim()}` : "Olá";

    await transporter.sendMail({
      from: `"Louzada Entregas" <${emailUser}>`,
      to,
      subject: "O Louzada Entregas está de cara nova (e com mais tempo de áudio!) 🚀",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #e7eef8;">
          <div style="background-color: #0f172a; padding: 28px; border-radius: 12px;">
            <h1 style="color: #00008f; margin: 0 0 8px 0; font-size: 26px;">Louzada Entregas</h1>
            <p style="color: #94a3b8; margin: 0; font-size: 14px;">Evoluções clínicas com mais inteligência</p>
          </div>

          <div style="background-color: white; padding: 28px; border-radius: 12px; margin-top: 16px;">
            <p style="font-size: 18px; color: #1e293b; margin: 0 0 16px 0;">${greeting}! 👋</p>

            <p style="font-size: 16px; line-height: 1.65; color: #475569; margin: 0 0 16px 0;">
              O <strong>Louzada Entregas está crescendo</strong>! Para continuarmos oferecendo a melhor inteligência artificial
              e um tempo maior de gravação — <strong>agora 2 minutos por evolução</strong> — nosso plano gratuito passa
              a ser o <strong>Plano Básico</strong>.
            </p>

            <div style="background: #e7eef8; border-left: 4px solid #00008f; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-size: 15px; color: #1e40af; font-weight: bold;">
                O que muda para você
              </p>
              <ul style="margin: 0; padding-left: 18px; color: #334155; font-size: 15px; line-height: 1.6;">
                <li>Mais <strong>${params.graceDays} dias de acesso livre</strong> a partir de agora</li>
                <li>Depois, assine por <strong>R$ ${params.monthlyPrice}/mês</strong> (ou <strong>R$ ${params.annualPerMonth}/mês</strong> no anual)</li>
                <li>Ao cadastrar o cartão, você ganha <strong>+${params.trialDays} dias de teste grátis</strong></li>
              </ul>
            </div>

            <p style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0 0 24px 0;">
              Seus pacientes, evoluções e histórico permanecem intactos. Basta ativar o Plano Básico quando estiver pronto.
            </p>

            <div style="text-align: center; margin: 28px 0;">
              <a href="${upgradeUrl}"
                 style="display: inline-block; background-color: #00008f; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Fazer upgrade agora
              </a>
            </div>

            <p style="font-size: 13px; color: #64748b; margin: 0; text-align: center;">
              Dúvidas? Responda este e-mail — estamos aqui para ajudar.
            </p>
          </div>

          <div style="text-align: center; padding: 16px; color: #94a3b8; font-size: 12px;">
            <p style="margin: 0;">Enviado por Louzada Entregas &lt;${emailUser}&gt;</p>
          </div>
        </div>
      `,
    });

    return { success: true };
  } catch (error) {
    console.error("[LEGACY SUNSET] Erro ao enviar e-mail:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao enviar e-mail",
    };
  }
}

