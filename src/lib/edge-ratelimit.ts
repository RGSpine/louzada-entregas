import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAiRateLimitPerHour,
  getAiRateLimitPerMinute,
} from "@/lib/ai-billing-rate-limit";
import { getRedis, hasKvRedisEnv } from "@/lib/redis";

/** Nível 1 — Auth / credential stuffing: 5 req / IP / 15 min */
export const EDGE_AUTH_MAX = 5;
const AUTH_WINDOW = "15 m" as const;

/** Nível 2 — IA / billing (minuto + hora; IP sempre; user se houver) */
export const EDGE_AI_MAX = 15; // default; sobrescrito por AI_RATE_LIMIT_PER_MINUTE
const AI_WINDOW = "1 m" as const;
const AI_HOUR_WINDOW = "1 h" as const;

/** Nível 3 — API geral / DDoS básico: 100 req / IP / min */
export const EDGE_API_MAX = 100;
const API_WINDOW = "1 m" as const;

/** Nível 4 — vitrine B2C (GET scrape + POST Server Action): 30 req / IP / min */
export const EDGE_MARKETPLACE_MAX = 30;
const MARKETPLACE_WINDOW = "1 m" as const;

const AUTH_PATH_PREFIXES = [
  "/api/auth",
  "/login",
  "/paciente/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

const AI_PATH_PREFIXES = [
  "/api/evolution",
  "/api/clinical-chat",
  "/api/b2c/health-intake",
  "/api/b2c/health-chat",
  "/api/metrics/generate",
  "/api/metrics/suggestions",
  "/api/patients/",
  "/api/finance-agent",
  "/api/office-finance/extract",
  "/api/agenda/intake",
  "/api/agenda/report",
  "/api/yield/intake",
  "/api/v1/evolution",
  "/api/v1/agenda/intake",
  "/api/v1/documents/",
  "/api/stripe/checkout",
  "/api/stripe/portal",
  "/api/stripe/downgrade",
] as const;

const AI_POLL_EXCLUSIONS = [
  "/api/evolution/jobs/",
  "/api/finance-agent/jobs/",
  "/api/office-finance/jobs/",
] as const;

let authLimiter: Ratelimit | null = null;
let aiMinuteLimiter: Ratelimit | null = null;
let aiHourLimiter: Ratelimit | null = null;
let apiLimiter: Ratelimit | null = null;
let marketplaceLimiter: Ratelimit | null = null;

/** Produção Vercel ou NODE_ENV=production → fail-closed em Auth/IA. */
export function isProductionRuntime(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Auth e IA: fail-closed em produção (Redis obrigatório).
 * API geral e ambientes não-prod: fail-open (disponibilidade).
 */
export function mustFailClosedCritical(): boolean {
  return isProductionRuntime();
}

function getAuthLimiter(): Ratelimit | null {
  if (authLimiter) return authLimiter;
  const redis = getRedis();
  if (!redis) return null;
  authLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(EDGE_AUTH_MAX, AUTH_WINDOW),
    prefix: "aievolui:edge:auth",
    analytics: false,
  });
  return authLimiter;
}

function getAiMinuteLimiter(): Ratelimit | null {
  if (aiMinuteLimiter) return aiMinuteLimiter;
  const redis = getRedis();
  if (!redis) return null;
  const max = getAiRateLimitPerMinute();
  aiMinuteLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, AI_WINDOW),
    prefix: `aievolui:edge:ai:m:${max}`,
    analytics: false,
  });
  return aiMinuteLimiter;
}

function getAiHourLimiter(): Ratelimit | null {
  if (aiHourLimiter) return aiHourLimiter;
  const redis = getRedis();
  if (!redis) return null;
  const max = getAiRateLimitPerHour();
  aiHourLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, AI_HOUR_WINDOW),
    prefix: `aievolui:edge:ai:h:${max}`,
    analytics: false,
  });
  return aiHourLimiter;
}

function getApiLimiter(): Ratelimit | null {
  if (apiLimiter) return apiLimiter;
  const redis = getRedis();
  if (!redis) return null;
  apiLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(EDGE_API_MAX, API_WINDOW),
    prefix: "aievolui:edge:api",
    analytics: false,
  });
  return apiLimiter;
}

function getMarketplaceLimiter(): Ratelimit | null {
  if (marketplaceLimiter) return marketplaceLimiter;
  const redis = getRedis();
  if (!redis) return null;
  marketplaceLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(EDGE_MARKETPLACE_MAX, MARKETPLACE_WINDOW),
    prefix: "aievolui:edge:marketplace",
    analytics: false,
  });
  return marketplaceLimiter;
}

/**
 * IP do cliente na Vercel.
 * Prefere `x-real-ip` (injetado pela plataforma). `x-forwarded-for` só como fallback.
 */
export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 64) return realIp;

  const vercelFwd = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelFwd) {
    const first = vercelFwd.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }

  return "127.0.0.1";
}

export function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export function isAuthRateLimitedPath(pathname: string, method: string): boolean {
  if (pathname.startsWith("/api/auth")) return true;
  if (AUTH_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return isMutatingMethod(method);
  }
  return false;
}

export function isAiRateLimitedPath(pathname: string): boolean {
  if (AI_POLL_EXCLUSIONS.some((p) => pathname.startsWith(p))) return false;
  if (pathname.startsWith("/api/evolution") && pathname.includes("/jobs/")) return false;
  return AI_PATH_PREFIXES.some((p) => {
    if (p === "/api/patients/") {
      return (
        pathname.startsWith("/api/patients/") &&
        (pathname.includes("/metrics") || pathname.includes("/auto-generate"))
      );
    }
    return pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p);
  });
}

export function isGeneralApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/** Vitrine B2C: GET (scraping) e POST (Server Actions em /buscar|/vitrine). */
export function isMarketplaceB2cPath(pathname: string): boolean {
  return (
    pathname === "/buscar" ||
    pathname.startsWith("/buscar/") ||
    pathname === "/vitrine" ||
    pathname.startsWith("/vitrine/") ||
    pathname === "/mapa-saude" ||
    pathname.startsWith("/mapa-saude/") ||
    pathname === "/reservar" ||
    pathname.startsWith("/reservar/") ||
    pathname === "/cadastro-paciente" ||
    pathname.startsWith("/cadastro-paciente/")
  );
}

/**
 * Extrai `sub` do JWT Supabase nos cookies (só para chave de rate limit).
 * JWT NÃO é verificado — por isso o Nível 2 SEMPRE limita também por IP.
 */
export function extractSupabaseUserIdFromCookies(request: NextRequest): string | null {
  const cookies = request.cookies.getAll();
  for (const cookie of cookies) {
    if (!cookie.name.startsWith("sb-") || !cookie.name.includes("auth-token")) continue;
    const raw = cookie.value;
    if (!raw) continue;

    try {
      let jsonStr = raw;
      if (raw.startsWith("base64-")) {
        const b64 = raw.slice("base64-".length);
        const pad = "=".repeat((4 - (b64.length % 4)) % 4);
        const binary = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
        jsonStr = binary;
      }

      const parsed = JSON.parse(jsonStr) as { access_token?: string };
      const token = parsed.access_token;
      if (!token || typeof token !== "string") continue;

      const parts = token.split(".");
      if (parts.length < 2) continue;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payloadJson = atob(payloadB64 + pad);
      const payload = JSON.parse(payloadJson) as { sub?: string; exp?: number };
      if (!payload.sub || typeof payload.sub !== "string") continue;
      if (payload.sub.length > 128) continue;
      if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) continue;
      return payload.sub;
    } catch {
      // tenta próximo cookie / chunk
    }
  }
  return null;
}

function tooManyRequests(resetUnixMs: number): NextResponse {
  const resetIn = Math.max(1, Math.ceil((resetUnixMs - Date.now()) / 1000));
  return new NextResponse("Muitas requisições.", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(resetIn),
      "X-RateLimit-Reset": String(resetIn),
    },
  });
}

/** Redis indisponível em produção (Auth/IA) — não abrir a porta. */
function serviceUnavailableRateLimit(): NextResponse {
  return new NextResponse(
    "Proteção temporariamente indisponível. Tente novamente em instantes.",
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "30",
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Rate limit na borda (Edge).
 * - Auth/IA em produção: fail-closed se Redis ausente ou erro.
 * - API geral / preview / local: fail-open se Redis falhar.
 */
export async function enforceEdgeRateLimit(
  request: NextRequest,
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  const method = request.method;
  const ip = getClientIp(request);
  const failClosed = mustFailClosedCritical();

  const needsAuth = isAuthRateLimitedPath(pathname, method);
  const needsAi = isAiRateLimitedPath(pathname) && isMutatingMethod(method);
  const needsApi = isGeneralApiPath(pathname);
  const needsMarketplace = isMarketplaceB2cPath(pathname);

  // Produção: Auth/IA exigem Redis configurado
  if (failClosed && (needsAuth || needsAi) && !hasKvRedisEnv()) {
    console.error(
      JSON.stringify({
        event: "security.edge_rate_limit_fail_closed",
        reason: "kv_env_missing",
        path: pathname,
      }),
    );
    return serviceUnavailableRateLimit();
  }

  try {
    if (needsAuth) {
      const limiter = getAuthLimiter();
      if (!limiter) {
        if (failClosed) return serviceUnavailableRateLimit();
      } else {
        const { success, reset } = await limiter.limit(`auth:ip:${ip}`);
        if (!success) return tooManyRequests(reset);
      }
    }

    if (needsAi) {
      const minuteLimiter = getAiMinuteLimiter();
      const hourLimiter = getAiHourLimiter();
      if (!minuteLimiter || !hourLimiter) {
        if (failClosed) return serviceUnavailableRateLimit();
      } else {
        const userId = extractSupabaseUserIdFromCookies(request);

        // Minuto: IP (anti-spoof JWT) + user
        const ipMin = await minuteLimiter.limit(`ai:ip:${ip}`);
        if (!ipMin.success) return tooManyRequests(ipMin.reset);
        if (userId) {
          const userMin = await minuteLimiter.limit(`ai:user:${userId}`);
          if (!userMin.success) return tooManyRequests(userMin.reset);
        }

        // Hora: teto de billing abuse
        const ipHour = await hourLimiter.limit(`ai:ip:${ip}`);
        if (!ipHour.success) return tooManyRequests(ipHour.reset);
        if (userId) {
          const userHour = await hourLimiter.limit(`ai:user:${userId}`);
          if (!userHour.success) return tooManyRequests(userHour.reset);
        }
      }
    }

    // Nível 3 — fail-open se Redis ausente
    if (needsApi) {
      const limiter = getApiLimiter();
      if (limiter) {
        const { success, reset } = await limiter.limit(`api:ip:${ip}`);
        if (!success) return tooManyRequests(reset);
      }
    }

    // Nível 4 — vitrine B2C (fail-open; mais apertado que API geral)
    if (needsMarketplace) {
      const limiter = getMarketplaceLimiter();
      if (limiter) {
        const { success, reset } = await limiter.limit(`mkt:ip:${ip}`);
        if (!success) return tooManyRequests(reset);
      }
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "security.edge_rate_limit_error",
        path: pathname,
        failClosed,
        critical: needsAuth || needsAi,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    if (failClosed && (needsAuth || needsAi)) {
      return serviceUnavailableRateLimit();
    }
  }

  return null;
}
