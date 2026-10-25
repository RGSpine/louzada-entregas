import { SITE_URL } from "@/lib/seo/site-config";

/** Base pública da app (sem barra final). Preferir env; fallback produção. */
export function getAppBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return SITE_URL;
}

/** Destino após verify nativo do Supabase (allowlist). */
export function getPasswordResetRedirectUrl(): string {
  return `${getAppBaseUrl()}/reset-password`;
}

/**
 * Landing do e-mail branded: token só é consumido após o usuário confirmar na página
 * (evita scanner/prefetch e race de searchParams no client).
 */
export function getAdminPinResetUrl(token: string): string {
  const url = new URL("/reset-admin-pin", `${getAppBaseUrl()}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

export function getPasswordRecoveryLandingUrl(tokenHash: string): string {
  const url = new URL("/auth/recovery", `${getAppBaseUrl()}/`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  return url.toString();
}
