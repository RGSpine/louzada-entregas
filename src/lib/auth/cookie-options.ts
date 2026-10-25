import type { CookieOptions } from "@supabase/ssr";

/** Opções compatíveis com Safari iOS (Secure + SameSite=Lax + Path=/). */
export function supabaseAuthCookieOptions(
  overrides?: Partial<CookieOptions>,
): CookieOptions {
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";

  return {
    path: "/",
    sameSite: "lax",
    secure,
    ...overrides,
  };
}

/** Mescla options do Supabase com defaults Safari-safe (não remove httpOnly). */
export function mergeAuthCookieOptions(
  options?: Partial<CookieOptions>,
): CookieOptions {
  return {
    ...supabaseAuthCookieOptions(),
    ...options,
    path: options?.path ?? "/",
    sameSite: options?.sameSite ?? "lax",
    secure:
      options?.secure ??
      (process.env.NODE_ENV === "production" ||
        process.env.VERCEL_ENV === "production" ||
        process.env.VERCEL_ENV === "preview"),
  };
}
