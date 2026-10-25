import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET não configurado.");
  }
  return secret;
}

/** State assinado: patientId + expiração. Não carrega tokens. */
export function signPatientGoogleOAuthState(patientId: string, now = Date.now()): string {
  const exp = now + STATE_TTL_MS;
  const payload = `${patientId}.${exp}`;
  const sig = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPatientGoogleOAuthState(
  state: string | null | undefined,
  now = Date.now(),
): { ok: true; patientId: string } | { ok: false; error: string } {
  if (!state || !state.includes(".")) {
    return { ok: false, error: "Estado OAuth inválido." };
  }
  const lastDot = state.lastIndexOf(".");
  const payload = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);
  const sep = payload.lastIndexOf(".");
  if (sep <= 0 || !sig) {
    return { ok: false, error: "Estado OAuth inválido." };
  }
  const patientId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!patientId || !Number.isFinite(exp)) {
    return { ok: false, error: "Estado OAuth inválido." };
  }

  const expected = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Estado OAuth inválido." };
  }
  if (exp < now) {
    return { ok: false, error: "A ligação expirou. Tente conectar de novo." };
  }
  return { ok: true, patientId };
}

export function patientGoogleOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/integrations/google/patient/callback`;
}

export function buildPatientGoogleOAuthUrl(params: {
  origin: string;
  patientId: string;
}): string {
  const clientId = process.env.AUTH_GOOGLE_ID?.trim();
  if (!clientId) {
    throw new Error("AUTH_GOOGLE_ID não configurado.");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", patientGoogleOAuthRedirectUri(params.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "openid email profile https://www.googleapis.com/auth/calendar.events",
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", signPatientGoogleOAuthState(params.patientId));
  return url.toString();
}
