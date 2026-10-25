import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { enforceEdgeRateLimit } from "@/lib/edge-ratelimit";
import {
  isCheckoutAllowedDashboardPath,
  PAID_ACCESS_COOKIE,
} from "@/lib/subscription-access";
import { mergeAuthCookieOptions } from "@/lib/auth/cookie-options";
import { isAuthSessionMutationPath } from "@/lib/auth/session-mutation-paths";
import {
  isB2bProtectedPath,
  isB2cAuthPath,
  isB2cPublicPath,
  safeMarketplaceRedirect,
} from "@/lib/marketplace/paths";

// B2B: sessão Supabase obrigatória. /buscar e /vitrine (B2C) ficam públicos.
const PROTECTED_ROUTES = ["/dashboard", "/admin"];

const SENSITIVE_API_PREFIXES = [
  "/api/evolution",
  "/api/stripe",
  "/api/agenda",
  "/api/office-finance",
  "/api/finance-agent",
  "/api/metrics",
  "/api/patients",
  "/api/v1",
  "/api/admin",
] as const;

function isSensitivePath(pathname: string): boolean {
  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) return true;
  if (pathname.startsWith("/auth/")) return true;
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/paciente/login"
  ) {
    return true;
  }
  return SENSITIVE_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function isRefreshTokenError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "refresh_token_not_found") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("refresh token") && msg.includes("not found");
}

/** Remove cookies de auth Supabase corrompidos (evita loop refresh_token_not_found). */
function clearSupabaseAuthCookies(response: NextResponse, request: NextRequest) {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      response.cookies.set(cookie.name, "", {
        ...mergeAuthCookieOptions(),
        httpOnly: true,
        maxAge: 0,
      });
    }
  }
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;

  // Rate limit na borda (Upstash/KV) — antes de Auth/DB; fail-open se Redis ausente.
  const rateLimited = await enforceEdgeRateLimit(request);
  if (rateLimited) return rateLimited;

  /** Sempre injeta x-pathname para o layout do dashboard (hard-block PENDING). */
  function nextWithPath() {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  let supabaseResponse = nextWithPath();

  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === "production" && isSensitivePath(pathname)) {
      console.error(
        JSON.stringify({
          event: "security.misconfig_supabase",
          path: pathname,
        }),
      );
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Serviço indisponível. Configuração de autenticação ausente." },
          { status: 503 },
        );
      }
      const url = new URL("/login", request.url);
      url.searchParams.set("error", "config");
      return NextResponse.redirect(url);
    }
    console.warn("[Proxy] Supabase não configurado - variáveis de ambiente ausentes");
    return supabaseResponse;
  }

  // login/refresh/exchange gerem a sessão no próprio handler.
  // getUser() aqui com cookie stale apaga o Set-Cookie do login (401 no refresh).
  if (isAuthSessionMutationPath(pathname)) {
    return supabaseResponse;
  }

  // Login paciente: precisa getUser() para redirecionar sessão ativa → mapa-saude.
  const isPatientLoginPath = pathname === "/paciente/login";

  // Vitrine B2C: sem getUser() — busca pública; rate limit já rodou na borda.
  if (isB2cPublicPath(pathname) && !isPatientLoginPath) {
    return supabaseResponse;
  }

  const needsAuthCheck =
    isB2bProtectedPath(pathname) ||
    isB2cAuthPath(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/access-session") ||
    pathname.startsWith("/api/agenda") ||
    pathname.startsWith("/api/stripe") ||
    pathname.startsWith("/api/evolution") ||
    pathname.startsWith("/api/integrations") ||
    pathname.startsWith("/auth/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/register/complete" ||
    pathname === "/reset-password" ||
    pathname === "/reset-admin-pin" ||
    pathname === "/forgot-password" ||
    isPatientLoginPath;

  if (!needsAuthCheck) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: mergeAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = nextWithPath();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, mergeAuthCookieOptions(options)),
          );
        },
      },
    });

    // Só getUser() — getSession() + refresh com token inválido dispara AuthApiError em loop.
    const { data: { user }, error } = await supabase.auth.getUser();
    const onCheckoutPath = isCheckoutAllowedDashboardPath(pathname);

    if (isRefreshTokenError(error)) {
      // Limpa cookies corrompidos. NUNCA 307 em /dashboard/planos:
      // planos ↔ login (paid=0) gerava loop infinito de HTTP 307.
      clearSupabaseAuthCookies(supabaseResponse, request);
      supabaseResponse.cookies.set(PAID_ACCESS_COOKIE, "", {
        ...mergeAuthCookieOptions(),
        httpOnly: true,
        maxAge: 0,
      });
      if (onCheckoutPath) {
        return supabaseResponse;
      }
      if (isB2bProtectedPath(pathname)) {
        const url = new URL("/login", request.url);
        url.searchParams.set("redirect", pathname);
        url.searchParams.set("reason", "session_expired");
        const redirectRes = NextResponse.redirect(url);
        clearSupabaseAuthCookies(redirectRes, request);
        redirectRes.cookies.set(PAID_ACCESS_COOKIE, "", {
          ...mergeAuthCookieOptions(),
          httpOnly: true,
          maxAge: 0,
        });
        return redirectRes;
      }
      return supabaseResponse;
    }

    const isProtectedRoute = isB2bProtectedPath(pathname);
    const isPatientAuthRoute = isB2cAuthPath(pathname);

    if (isPatientAuthRoute && (!user || error)) {
      const url = new URL("/paciente/login", request.url);
      url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(url);
    }

    if (isProtectedRoute && (!user || error)) {
      // Em /planos: layout decide (uma redirect). Edge 307 aqui alimenta o loop.
      if (onCheckoutPath) {
        return supabaseResponse;
      }
      const url = new URL("/login", request.url);
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }

    if (pathname === "/register/complete" && user && !error) {
      return supabaseResponse;
    }
    if (pathname === "/reset-password" && user && !error) {
      return supabaseResponse;
    }
    if (pathname === "/reset-admin-pin" && user && !error) {
      return supabaseResponse;
    }
    if (pathname === "/register" && user && !error) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    // Soft-redirect: /login com destino B2C → login paciente (mantém query).
    if (pathname === "/login" && (!user || error)) {
      const b2cReturn = safeMarketplaceRedirect(
        request.nextUrl.searchParams.get("redirect"),
      );
      if (b2cReturn) {
        const patientLogin = new URL("/paciente/login", request.url);
        request.nextUrl.searchParams.forEach((value, key) => {
          patientLogin.searchParams.set(key, value);
        });
        return NextResponse.redirect(patientLogin);
      }
    }

    if (pathname === "/paciente/login" && user && !error) {
      const b2cReturn = safeMarketplaceRedirect(
        request.nextUrl.searchParams.get("redirect"),
      );
      if (b2cReturn) {
        return NextResponse.redirect(new URL(b2cReturn, request.url));
      }
      return NextResponse.redirect(new URL("/mapa-saude", request.url));
    }

    if (pathname === "/login" && user && !error) {
      // Sessão acabou de expirar: não bounce de volta a planos (evita 307 loop).
      const reason = request.nextUrl.searchParams.get("reason");
      if (reason === "session_expired") {
        return supabaseResponse;
      }
      // Paciente voltando da vitrine B2C: não empurrar para o dashboard clínico.
      const b2cReturn = safeMarketplaceRedirect(
        request.nextUrl.searchParams.get("redirect"),
      );
      if (b2cReturn) {
        return NextResponse.redirect(new URL(b2cReturn, request.url));
      }
      // Conta marcada como paciente (signup B2C): Mapa de Saúde.
      if (user.user_metadata?.audience === "patient") {
        return NextResponse.redirect(new URL("/mapa-saude", request.url));
      }
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch (err) {
    console.error("[Proxy] Erro ao atualizar sessão:", err);
    const isProtectedRoute = isB2bProtectedPath(pathname);
    if (isProtectedRoute && !isCheckoutAllowedDashboardPath(pathname)) {
      const redirectRes = NextResponse.redirect(new URL("/login", request.url));
      clearSupabaseAuthCookies(redirectRes, request);
      return redirectRes;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|monitoring|sw.js|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
