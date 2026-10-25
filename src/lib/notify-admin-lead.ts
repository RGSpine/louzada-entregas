import nodemailer from "nodemailer";
import { PRO_PRIORITY_SUPPORT_WHATSAPP_E164 } from "@/lib/pro-priority-support";

export type AdminLeadNotifyInput = {
  name: string;
  email: string;
  phone: string;
  profileLabel: string;
  description: string;
  source: "public" | "dashboard";
  userId?: string | null;
};

function buildLeadMessage(input: AdminLeadNotifyInput): string {
  const lines = [
    "🆕 Lead — Plataforma personalizada (Louzada Entregas)",
    "",
    `Nome: ${input.name}`,
    `E-mail: ${input.email}`,
    `WhatsApp: ${input.phone}`,
    `Perfil: ${input.profileLabel}`,
    `Origem: ${input.source === "dashboard" ? "Usuário logado" : "Visitante (sem login)"}`,
    input.userId ? `ID usuário: ${input.userId}` : null,
    "",
    "Descrição / pedido:",
    input.description,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

async function sendLeadEmail(message: string, replyTo: string): Promise<boolean> {
  const sacEmail = process.env.SAC_EMAIL?.trim();
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.trim();

  if (!sacEmail || !emailUser || !emailPass) {
    console.error("[platform-lead] E-mail SAC não configurado (SAC_EMAIL, EMAIL_USER, EMAIL_PASS)");
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPass },
  });

  await transporter.sendMail({
    from: `"Louzada Entregas Leads" <${emailUser}>`,
    to: sacEmail,
    replyTo,
    subject: "[Lead] Plataforma personalizada — Louzada Entregas",
    text: message,
    html: `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${message.replace(/</g, "&lt;")}</pre>`,
  });

  return true;
}

async function sendLeadViaWhatsAppCloud(message: string): Promise<boolean> {
  const token = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return false;

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: PRO_PRIORITY_SUPPORT_WHATSAPP_E164,
      type: "text",
      text: { body: message.slice(0, 4096) },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[platform-lead] WhatsApp Cloud falhou:", res.status, body.slice(0, 300));
    return false;
  }

  return true;
}

/** Z-API (opcional): ZAPI_INSTANCE_ID + ZAPI_TOKEN no .env */
async function sendLeadViaZApi(message: string): Promise<boolean> {
  const instanceId = process.env.ZAPI_INSTANCE_ID?.trim();
  const token = process.env.ZAPI_TOKEN?.trim();
  if (!instanceId || !token) return false;

  const clientToken = process.env.ZAPI_CLIENT_TOKEN?.trim();
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientToken ? { "Client-Token": clientToken } : {}),
    },
    body: JSON.stringify({
      phone: PRO_PRIORITY_SUPPORT_WHATSAPP_E164,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[platform-lead] Z-API falhou:", res.status, body.slice(0, 300));
    return false;
  }

  return true;
}

export async function notifyAdminPlatformLead(
  input: AdminLeadNotifyInput,
): Promise<{ ok: boolean; channel: "whatsapp" | "email" | "none" }> {
  const message = buildLeadMessage(input);

  const viaWhatsAppCloud = await sendLeadViaWhatsAppCloud(message);
  if (viaWhatsAppCloud) {
    return { ok: true, channel: "whatsapp" };
  }

  const viaWhatsApp = await sendLeadViaZApi(message);
  if (viaWhatsApp) {
    return { ok: true, channel: "whatsapp" };
  }

  const viaEmail = await sendLeadEmail(message, input.email);
  if (viaEmail) {
    return { ok: true, channel: "email" };
  }

  return { ok: false, channel: "none" };
}
