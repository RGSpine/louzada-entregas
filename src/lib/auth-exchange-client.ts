/**
 * Troca tokens/códigos de auth via API server-side (sem expor Supabase SDK no browser).
 */
export async function exchangeAuthSession(
  payload:
    | { kind: "code"; code: string }
    | { kind: "otp"; tokenHash: string; type: "email" | "magiclink" | "recovery" | "signup" | "invite" }
    | { kind: "tokens"; accessToken: string; refreshToken: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        payload.kind === "code"
          ? { kind: "code", code: payload.code }
          : payload.kind === "otp"
            ? { kind: "otp", tokenHash: payload.tokenHash, type: payload.type }
            : {
                kind: "tokens",
                accessToken: payload.accessToken,
                refreshToken: payload.refreshToken,
              },
      ),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Link inválido ou expirado." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Erro de rede ao validar o link." };
  }
}

/** Extrai access/refresh tokens do hash (#...) retornado por links Supabase legados. */
export function parseSupabaseHashTokens(hash: string): {
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
} {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    type: params.get("type"),
  };
}

export async function refreshAuthSessionClient(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}
