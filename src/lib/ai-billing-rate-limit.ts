/**
 * Rate limit anti billing-abuse para rotas/actions que chamam LLMs.
 * Usa o mesmo Redis Upstash/KV (`KV_REST_API_*`) — sem NEXT_PUBLIC.
 *
 * Janelas (configuráveis por env, só servidor):
 *   AI_RATE_LIMIT_PER_MINUTE  (default 15)
 *   AI_RATE_LIMIT_PER_HOUR    (default 60)
 */

import { enforceRateLimit, type RateLimitResult } from "@/lib/rate-limit";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 10_000);
}

/** Limite por minuto (burst). */
export function getAiRateLimitPerMinute(): number {
  return parsePositiveInt(process.env.AI_RATE_LIMIT_PER_MINUTE, 15);
}

/** Limite por hora (exaustão financeira). */
export function getAiRateLimitPerHour(): number {
  return parsePositiveInt(process.env.AI_RATE_LIMIT_PER_HOUR, 60);
}

export type AiBillingIdentity = {
  /** Preferencial: auth user id / email estável */
  userKey?: string | null;
  /** IP do cliente (quando disponível — Edge / request headers) */
  ip?: string | null;
};

/**
 * Aplica minuto + hora por IP (se houver) e por usuário (se houver).
 * Retorna o primeiro bloqueio encontrado.
 */
export async function enforceAiBillingRateLimit(
  identity: AiBillingIdentity,
): Promise<RateLimitResult> {
  const perMin = getAiRateLimitPerMinute();
  const perHour = getAiRateLimitPerHour();
  const minuteCfg = { maxRequests: perMin, windowSeconds: 60 };
  const hourCfg = { maxRequests: perHour, windowSeconds: 3600 };

  const keys: string[] = [];
  const ip = identity.ip?.trim();
  const userKey = identity.userKey?.trim();
  if (ip) {
    keys.push(`ai-bill:ip:${ip}:m`, `ai-bill:ip:${ip}:h`);
  }
  if (userKey) {
    keys.push(`ai-bill:user:${userKey}:m`, `ai-bill:user:${userKey}:h`);
  }
  // Sem identidade: ainda limita por bucket anônimo (defesa mínima)
  if (keys.length === 0) {
    keys.push("ai-bill:anon:m", "ai-bill:anon:h");
  }

  let lastOk: RateLimitResult = {
    allowed: true,
    remaining: perMin,
    resetIn: 60,
  };

  for (const key of keys) {
    const isHour = key.endsWith(":h");
    const cfg = isHour ? hourCfg : minuteCfg;
    const result = await enforceRateLimit(key, cfg);
    if (!result.allowed) return result;
    lastOk = result;
  }
  return lastOk;
}

/** Mensagem amigável para API / Server Action. */
export function aiBillingRateLimitMessage(resetIn: number): string {
  const sec = Math.max(1, resetIn);
  if (sec >= 60) {
    const min = Math.ceil(sec / 60);
    return `Limite de uso de IA atingido. Tente novamente em cerca de ${min} min.`;
  }
  return `Limite de uso de IA atingido. Tente novamente em ${sec}s.`;
}
