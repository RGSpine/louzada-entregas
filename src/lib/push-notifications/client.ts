"use client";

const DISMISS_KEY = "aievolui_push_prompt_dismissed_until";

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isPushPromptDismissed(): boolean {
  try {
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

export function dismissPushPrompt(days = 7): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  } catch {
    // ignore
  }
}

export type WebPushUiStatus =
  | "loading"
  | "unsupported"
  | "denied"
  | "subscribed"
  | "unsubscribed"
  | "needs_ios_install";

/** Estado atual da subscription no browser (para toggle em Meu Perfil). */
export async function getWebPushUiStatus(options?: {
  iosNeedsInstall?: boolean;
}): Promise<WebPushUiStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (options?.iosNeedsInstall) return "needs_ios_install";
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") return "subscribed";
    return "unsubscribed";
  } catch {
    return "unsupported";
  }
}

export async function subscribeToWebPush(): Promise<"granted" | "denied" | "unsupported" | "error"> {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const registration = await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "same-origin" });
    if (!keyRes.ok) return "error";
    const { publicKey } = (await keyRes.json()) as { publicKey?: string };
    if (!publicKey) return "error";

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    return res.ok ? "granted" : "error";
  } catch {
    return "error";
  }
}

export async function unsubscribeFromWebPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    await fetch("/api/push/subscribe", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}
