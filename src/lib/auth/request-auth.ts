import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  resolveDbUserFromSupabaseAuth,
  type AuthenticatedContext,
} from "@/lib/auth/session-user";
import {
  ACCESS_SESSION_COOKIE,
  getMaxConcurrentSessionsForPlan,
  isAccessSessionActive,
  isLastLoginWinsSessionPlan,
  registerAccessSession,
  touchAccessSession,
} from "@/lib/access-session";
import { isPlatformOwnerEmail } from "@/lib/plan-limits";
import { needsBasicoCheckout } from "@/lib/basico-plan";

export type AuthFailureReason =
  | "missing_credentials"
  | "invalid_token"
  | "user_not_found"
  | "account_blocked"
  | "access_limit_exceeded"
  | "access_session_invalid"
  | "checkout_required";

export type AuthResult =
  | { ok: true; ctx: AuthenticatedContext; method: "bearer" | "cookie" }
  | { ok: false; reason: AuthFailureReason };

function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Extrai JWT do header Authorization (Bearer). Exportado para testes. */
export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

async function getSupabaseUserFromBearer(token: string) {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error("Supabase não configurado para validação Bearer.");
  }

  const supabase = createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

function deviceIdFromRequest(request: NextRequest): string {
  const header = request.headers.get("x-device-id")?.trim();
  if (header) return header;
  return request.cookies.get(ACCESS_SESSION_COOKIE)?.value?.trim() ?? "";
}

async function enforceAccessSession(
  request: NextRequest,
  ctx: AuthenticatedContext,
): Promise<AuthResult | null> {
  // Dono da plataforma: sem teto de dispositivos concorrentes.
  if (isPlatformOwnerEmail(ctx.email)) return null;

  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) {
    return { ok: false, reason: "access_session_invalid" };
  }

  const active = await isAccessSessionActive({
    userId: ctx.dbUser.id,
    deviceId,
  });

  if (active) {
    await touchAccessSession({ userId: ctx.dbUser.id, deviceId });
    return null;
  }

  const maxSessions = getMaxConcurrentSessionsForPlan(
    ctx.dbUser.plan,
    ctx.email,
    ctx.dbUser.isInfluencer,
  );
  // Individual: API não reassume o slot — só login/claim explícito.
  if (isLastLoginWinsSessionPlan(maxSessions)) {
    return { ok: false, reason: "access_session_invalid" };
  }

  const registration = await registerAccessSession({
    userId: ctx.dbUser.id,
    deviceId,
    userAgent: request.headers.get("user-agent"),
  });
  if (!registration.ok) {
    return {
      ok: false,
      reason:
        registration.reason === "limit_exceeded"
          ? "access_limit_exceeded"
          : "access_session_invalid",
    };
  }

  return null;
}

async function getSupabaseUserFromCookies() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

/**
 * Autentica requisições HTTP com Bearer (mobile/desktop) ou cookie (web).
 * Não altera o fluxo web existente — é opt-in nas rotas /api/v1.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthResult> {
  const bearer = extractBearerToken(request);

  let authUser = bearer ? await getSupabaseUserFromBearer(bearer) : null;
  let method: "bearer" | "cookie" = "bearer";

  if (!authUser) {
    authUser = await getSupabaseUserFromCookies();
    method = "cookie";
  }

  if (!authUser) {
    return {
      ok: false,
      reason: bearer ? "invalid_token" : "missing_credentials",
    };
  }

  const ctx = await resolveDbUserFromSupabaseAuth(authUser);
  if (!ctx) {
    return { ok: false, reason: "user_not_found" };
  }

  if (ctx.dbUser.isBlocked) {
    return { ok: false, reason: "account_blocked" };
  }

  // Conta criada no cadastro, mas sem Stripe: APIs do produto ficam bloqueadas.
  if (
    needsBasicoCheckout({
      basicoCheckoutRequired: ctx.dbUser.basicoCheckoutRequired,
      stripeSubscriptionId: ctx.dbUser.stripeSubscriptionId,
      isInfluencer: ctx.dbUser.isInfluencer,
      plan: ctx.dbUser.plan,
    })
  ) {
    return { ok: false, reason: "checkout_required" };
  }

  const accessDenied = await enforceAccessSession(request, ctx);
  if (accessDenied) return accessDenied;

  return { ok: true, ctx, method };
}

/** Atalho para Server Actions — mantém cookie-only (comportamento web atual). */
export async function authenticateServerAction(): Promise<AuthResult> {
  const authUser = await getSupabaseUserFromCookies();
  if (!authUser) {
    return { ok: false, reason: "missing_credentials" };
  }

  const ctx = await resolveDbUserFromSupabaseAuth(authUser);
  if (!ctx) {
    return { ok: false, reason: "user_not_found" };
  }

  if (ctx.dbUser.isBlocked) {
    return { ok: false, reason: "account_blocked" };
  }

  if (
    needsBasicoCheckout({
      basicoCheckoutRequired: ctx.dbUser.basicoCheckoutRequired,
      stripeSubscriptionId: ctx.dbUser.stripeSubscriptionId,
      isInfluencer: ctx.dbUser.isInfluencer,
      plan: ctx.dbUser.plan,
    })
  ) {
    return { ok: false, reason: "checkout_required" };
  }

  return { ok: true, ctx, method: "cookie" };
}
