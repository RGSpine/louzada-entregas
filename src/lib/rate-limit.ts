/**
 * Rate limiting (Node / Server Actions / API routes):
 * Redis via KV_REST_API_* (ou UPSTASH_REDIS_REST_*); fallback em memória.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { getRedis, hasKvRedisEnv } from "@/lib/redis";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

const upstashLimiters = new Map<string, Ratelimit>();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    if (now > entry.resetTime) rateLimitStore.delete(key);
  }
}

function getUpstashLimiter(config: RateLimitConfig): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cacheKey = `${config.maxRequests}:${config.windowSeconds}`;
  let limiter = upstashLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        config.maxRequests,
        `${config.windowSeconds} s`,
      ),
      prefix: `aievolui:rl:${cacheKey}`,
    });
    upstashLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/** Fallback síncrono em memória (por instância). */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  cleanupExpired();
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + windowMs });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetIn: config.windowSeconds,
    };
  }

  entry.count++;
  const resetIn = Math.ceil((entry.resetTime - now) / 1000);

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetIn,
  };
}

/**
 * Rate limit distribuído (Upstash) com fallback em memória.
 * Use em rotas de IA, pagamento e auth.
 */
export async function enforceRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (hasKvRedisEnv()) {
    try {
      const limiter = getUpstashLimiter(config);
      if (limiter) {
        const { success, remaining, reset } = await limiter.limit(identifier);
        const resetIn = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
        return {
          allowed: success,
          remaining: success ? remaining : 0,
          resetIn,
        };
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "security.rate_limit_upstash_fallback",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return checkRateLimit(identifier, config);
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = { maxRequests: 5, windowSeconds: 60 };
export const SIGNUP_RATE_LIMIT: RateLimitConfig = { maxRequests: 8, windowSeconds: 3600 };
/** Recuperação de senha — alinhado ao cooldown do Supabase Auth (~60s). */
export const FORGOT_PASSWORD_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1,
  windowSeconds: 60,
};
/**
 * Burst por minuto em rotas LLM (Node).
 * Preferir `enforceAiBillingRateLimit` (minuto + hora) em novos caminhos.
 * Defaults alinhados a AI_RATE_LIMIT_PER_MINUTE (15) quando a env não existe ainda no boot.
 */
export const AI_GENERATION_RATE_LIMIT: RateLimitConfig = {
  maxRequests: Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE ?? "15", 10) || 15,
  windowSeconds: 60,
};

/** Teto horário anti billing-abuse (Node). */
export const AI_GENERATION_HOURLY_RATE_LIMIT: RateLimitConfig = {
  maxRequests: Number.parseInt(process.env.AI_RATE_LIMIT_PER_HOUR ?? "60", 10) || 60,
  windowSeconds: 3600,
};

/** Geração de documentos clínicos (PDF por IA) — por utilizador. */
export const DOCUMENT_GENERATION_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 8,
  windowSeconds: 60,
};

/** Chat clínico por paciente — por utilizador. */
export const CLINICAL_CHAT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 8,
  windowSeconds: 60,
};

/** Indicações proativas (Ester) — refresh manual por profissional. */
export const CLINICAL_RECOMMENDATIONS_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 6,
  windowSeconds: 3600,
};

/** GET /api/document-share — por IP. */
export const DOCUMENT_SHARE_REDIRECT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 45,
  windowSeconds: 60,
};

/** Upload / remoção da logo no perfil — por utilizador. */
export const PROFILE_LOGO_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 15,
  windowSeconds: 3600,
};

/** Preferências de entrega do PDF (download / e-mail) — por utilizador. */
export const PROFILE_DELIVERY_PREFS_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowSeconds: 60,
};

/** Exportação CSV Receita Saúde — por utilizador. */
export const FISCAL_EXPORT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 3600,
};

/** Emissão NFS-e (Fase 1) — por utilizador. */
export const FISCAL_EMIT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowSeconds: 3600,
};

/** Cancelamento NFS-e (Fase 1.2) — por utilizador. */
export const FISCAL_CANCEL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowSeconds: 3600,
};

/** Upload certificado A1 (Fase 1.1) — por utilizador. */
export const FISCAL_CERTIFICATE_UPLOAD_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 3600,
};

/** Polling de jobs async (evolução / finanças) — por utilizador. */
export const JOB_POLL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowSeconds: 60,
};

/** Portal Stripe — por utilizador. */
export const STRIPE_PORTAL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
};

/** Leituras autenticadas em /api/v1/* — por utilizador. */
export const API_V1_READ_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowSeconds: 60,
};

/** Escritas autenticadas em /api/v1/* (agenda, etc.) — por utilizador. */
export const API_V1_WRITE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 60,
  windowSeconds: 60,
};

/** Tentativas de PIN de Intra User ADMIN — por tenant + perfil. */
export const INTRA_USER_PIN_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 60,
};

/** Edição do cadastro clínico do paciente (ficha). */
export const PATIENT_PROFILE_UPDATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowSeconds: 60,
};

/** Geração/download de PDF de evolução já persistida (nativa ou importada). */
export const EVOLUTION_PDF_DOWNLOAD_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowSeconds: 60,
};

/** Busca B2C do marketplace (PostGIS) — por IP ou utilizador. */
export const MARKETPLACE_SEARCH_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 40,
  windowSeconds: 60,
};

/** Reserva de horário no marketplace — por paciente autenticado. */
export const MARKETPLACE_BOOK_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 12,
  windowSeconds: 60,
};
