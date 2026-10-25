/**
 * Web Push (VAPID) — PWA Android e iOS 16.4+ (instalado na tela inicial).
 */

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

export function getVapidPublicKey(): string | null {
  const key =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    process.env.VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

export function getVapidPrivateKey(): string | null {
  return process.env.VAPID_PRIVATE_KEY?.trim() || null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}

export function getVapidSubject(): string {
  const fromEnv = process.env.VAPID_SUBJECT?.trim();
  if (fromEnv) return fromEnv;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return `mailto:suporte@${new URL(appUrl).hostname.replace(/^www\./, "")}`;
}

export function buildPushPayloadJson(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 500),
    url: payload.url?.slice(0, 500) ?? "/dashboard",
    tag: payload.tag?.slice(0, 128),
    icon: payload.icon ?? "/icons/icon-192.png",
  });
}
