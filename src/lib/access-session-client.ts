import { getOrCreateDeviceId } from "@/lib/device-id-client";

const ACCESS_SESSION_FETCH_MS = 30_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export type ClaimAccessSessionResult =
  | { ok: true }
  | {
      ok: false;
      errorCode?: string;
      error?: string;
      maxSessions?: number;
      redirectTo?: string;
    };

export async function claimAccessSessionClient(): Promise<ClaimAccessSessionResult> {
  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return { ok: false, error: "Dispositivo inválido." };
  try {
    const res = await fetchWithTimeout(
      "/api/access-session",
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, platform: "web", claim: true }),
      },
      ACCESS_SESSION_FETCH_MS,
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as {
      errorCode?: string;
      error?: string;
      maxSessions?: number;
      redirectTo?: string;
    };
    return {
      ok: false,
      errorCode: data.errorCode,
      error: data.error,
      maxSessions: data.maxSessions,
      redirectTo: data.redirectTo,
    };
  } catch {
    return { ok: false, error: "Não foi possível validar o acesso neste dispositivo." };
  }
}

export async function releaseAccessSessionClient(): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return;
  try {
    await fetchWithTimeout(
      "/api/access-session",
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      },
      ACCESS_SESSION_FETCH_MS,
    );
  } catch {
    // não bloqueia logout
  }
}
