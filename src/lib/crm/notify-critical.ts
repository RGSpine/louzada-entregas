import "server-only";

import nodemailer from "nodemailer";
import { ADMIN_EMAIL } from "@/lib/plan-limits";
import { getAppBaseUrl } from "@/lib/app-url";

export type CrmCriticalNotifyInput = {
  alertId: string;
  userId: string;
  alertType: string;
  title: string;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
  suggestedMessage?: string | null;
};

/**
 * Avisa o dono da plataforma (ADMIN_EMAIL) quando nasce um alerta CRM CRITICAL.
 * Fail-open: falha de e-mail não quebra o fluxo de sync/webhook.
 */
export async function notifyAdminCrmCritical(
  input: CrmCriticalNotifyInput,
): Promise<{ ok: boolean }> {
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.trim();
  // Aceita múltiplos e-mails separados por vírgula (ex.: sac@…,dono@…).
  const to =
    process.env.CRM_ALERT_EMAIL?.trim() ||
    process.env.SAC_EMAIL?.trim() ||
    ADMIN_EMAIL;

  const display = input.userName?.trim() || input.userEmail || input.userId;
  const base = getAppBaseUrl().replace(/\/$/, "");
  const crmUrl = `${base}/admin/crm/${input.userId}`;

  const text = [
    "Alerta CRM CRITICAL — Louzada Entregas",
    "",
    `Tipo: ${input.alertType}`,
    `Título: ${input.title}`,
    `Conta: ${display}`,
    input.userEmail ? `E-mail: ${input.userEmail}` : null,
    "",
    input.message,
    "",
    input.suggestedMessage
      ? `Mensagem sugerida:\n${input.suggestedMessage}`
      : null,
    "",
    `Abrir no CRM: ${crmUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  if (!emailUser || !emailPass) {
    console.warn(
      "[crm] notifyAdminCrmCritical: EMAIL_USER/EMAIL_PASS ausentes — log only",
      { alertType: input.alertType, userId: input.userId, to },
    );
    console.info("[crm] CRITICAL alert:\n" + text);
    return { ok: false };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    await transporter.sendMail({
      from: `"Louzada Entregas CRM" <${emailUser}>`,
      to,
      subject: `[CRM CRITICAL] ${input.title} — ${display}`,
      text,
      html: `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${text.replace(/</g, "&lt;")}</pre>`,
    });
    return { ok: true };
  } catch (err) {
    console.error("[crm] notifyAdminCrmCritical failed:", err);
    return { ok: false };
  }
}
