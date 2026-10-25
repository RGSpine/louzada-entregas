"use server";

import nodemailer from "nodemailer";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

export interface SendFeedbackResult {
  success: boolean;
  error?: string;
}

type FeedbackCategory = "feedback" | "bug" | "duvida" | "reclamacao" | "sugestao";

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  feedback: "Feedback geral",
  bug: "Reportar problema",
  duvida: "Dúvida",
  reclamacao: "Reclamação",
  sugestao: "Sugestão de melhoria",
};

export async function sendFeedbackAction(data: {
  category: string;
  subject: string;
  message: string;
}): Promise<SendFeedbackResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return { success: false, error: "Faça login para enviar sua mensagem." };
    }

    const rateCheck = await enforceRateLimit(`support:${authUser.email}`, {
      maxRequests: 5,
      windowSeconds: 3600, // 5 por hora
    });
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: `Você já enviou muitas mensagens. Tente novamente em ${rateCheck.resetIn} segundos.`,
      };
    }

    const { category, subject, message } = data;

    if (!subject?.trim() || !message?.trim()) {
      return { success: false, error: "Preencha o assunto e a mensagem." };
    }
    if (message.trim().length < 10) {
      return { success: false, error: "A mensagem deve ter pelo menos 10 caracteres." };
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: authUser.id }, { email: authUser.email }],
      },
      select: { name: true, email: true, plan: true, profession: true, id: true },
    });

    const userName = dbUser?.name || authUser.email;
    const userPlan = dbUser?.plan ?? null;
    const userProfession = dbUser?.profession || "Não informada";
    const categoryLabel =
      CATEGORY_LABELS[category as FeedbackCategory] || "Feedback geral";

    const sacEmail = process.env.SAC_EMAIL;
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!sacEmail || !emailUser || !emailPass) {
      console.error("[support] Variáveis de e-mail faltando (SAC_EMAIL, EMAIL_USER, EMAIL_PASS)");
      return { success: false, error: "Sistema de suporte indisponível. Tente novamente mais tarde." };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    await transporter.sendMail({
      from: `"Louzada Entregas SAC" <${emailUser}>`,
      to: sacEmail,
      replyTo: authUser.email,
      subject: `[SAC] ${categoryLabel}: ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background-color: #0f172a; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #00008f; margin: 0; font-size: 22px;">Louzada Entregas — SAC</h1>
            <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Nova mensagem de suporte</p>
          </div>
          <div style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 28px; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b; white-space: nowrap;">Usuário:</td>
                <td style="padding: 6px 0; color: #1e293b; font-weight: 600;">${userName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">E-mail:</td>
                <td style="padding: 6px 0; color: #1e293b;">${authUser.email}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">Profissão:</td>
                <td style="padding: 6px 0; color: #1e293b;">${userProfession}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">Plano:</td>
                <td style="padding: 6px 0; color: #1e293b;">${userPlan}</td>
              </tr>
              <tr>
                <td style="padding: 6px 12px 6px 0; color: #64748b;">Categoria:</td>
                <td style="padding: 6px 0;">
                  <span style="background-color: #dbeafe; color: #1e40af; padding: 3px 10px; border-radius: 6px; font-size: 13px;">${categoryLabel}</span>
                </td>
              </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
            <h3 style="color: #1e293b; margin: 0 0 8px; font-size: 16px;">${subject}</h3>
            <div style="color: #475569; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${message}</div>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 12px;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">Responda diretamente a este e-mail para falar com o usuário.</p>
          </div>
        </div>
      `,
    });

    if (dbUser?.id) {
      const { createCrmSupportAlert } = await import("@/lib/crm/support-alert");
      void createCrmSupportAlert({
        userId: dbUser.id,
        category,
        subject,
        message,
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[support] Erro ao enviar feedback:", error);
    return {
      success: false,
      error: "Erro ao enviar mensagem. Tente novamente.",
    };
  }
}
