/** Rotas B2C públicas (vitrine + cadastro/landing/login do paciente). Sem sessão no Edge. */
export const B2C_PUBLIC_PATHS = [
  "/buscar",
  "/vitrine",
  "/cadastro-paciente",
  "/paciente",
] as const;

/** Login paciente (público; sessão opcional redireciona no proxy). */
export const PATIENT_LOGIN_PATH = "/paciente/login" as const;

/**
 * Rotas B2C que exigem login do paciente.
 * `/mapa-saude` = dashboard do paciente (não confundir com `/dashboard` B2B).
 */
export const B2C_AUTH_PATHS = ["/reservar", "/mapa-saude"] as const;

/** Reserva temporária até confirmação/pagamento. */
export const SLOT_HOLD_MINUTES = 10;

function matchesPathPrefix(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isB2cPublicPath(pathname: string): boolean {
  return B2C_PUBLIC_PATHS.some((path) => matchesPathPrefix(pathname, path));
}

export function isB2cAuthPath(pathname: string): boolean {
  return B2C_AUTH_PATHS.some((path) => matchesPathPrefix(pathname, path));
}

export function isB2bProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
}

function isMarketplaceAudiencePath(pathname: string): boolean {
  return isB2cPublicPath(pathname) || isB2cAuthPath(pathname);
}

/** Evita open redirect: só path interno, sem protocol-relative. */
export function safeMarketplaceRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return null;
  }
  const pathname = path.split("?")[0] ?? path;
  if (pathname === PATIENT_LOGIN_PATH || pathname.startsWith(`${PATIENT_LOGIN_PATH}/`)) {
    return path;
  }
  if (isMarketplaceAudiencePath(pathname)) return path;
  return null;
}

/** Monta URL de login paciente preservando redirect B2C seguro. */
export function patientLoginHref(redirect?: string | null): string {
  const safe = safeMarketplaceRedirect(redirect);
  if (!safe) return PATIENT_LOGIN_PATH;
  return `${PATIENT_LOGIN_PATH}?redirect=${encodeURIComponent(safe)}`;
}
