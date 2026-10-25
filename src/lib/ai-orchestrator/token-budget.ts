/**
 * Orçamento soft diário de tokens por usuário (plano).
 * Conta via Redis; sem Redis → fail-open (só log).
 *
 * Hard block só se AI_TOKEN_BUDGET_HARD=1.
 */

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import {
  effectivePlanForFeatures,
  isPlatformOwnerEmail,
} from "@/lib/plan-limits";
import { isPendingCheckoutPlan } from "@/lib/basico-plan";

export type TokenBudgetCheck = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  hard: boolean;
  /** true quando Redis ausente — não bloqueia. */
  failOpen: boolean;
};

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function redisKey(userId: string, day = utcDayKey()): string {
  return `ai_token_budget:v1:${userId}:${day}`;
}

/**
 * Teto diário estimado (input+output). Env:
 *   AI_TOKEN_BUDGET_BASICO / _PROFISSIONAL / _PREMIUM
 * Default: Básico 80k · Profissional 250k · Premium+ 800k
 */
export function dailyTokenLimitForPlan(
  userPlan: string | null | undefined,
  email?: string | null,
  isInfluencer?: boolean,
): number {
  if (isPlatformOwnerEmail(email)) return Number.POSITIVE_INFINITY;
  if (isPendingCheckoutPlan(userPlan)) return 0;

  const plan = effectivePlanForFeatures(userPlan, !!isInfluencer);
  const fromEnv = (key: string, fallback: number) => {
    const n = Number(process.env[key]?.trim());
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  switch (plan) {
    case "BASICO":
      return fromEnv("AI_TOKEN_BUDGET_BASICO", 80_000);
    case "PROFISSIONAL":
      return fromEnv("AI_TOKEN_BUDGET_PROFISSIONAL", 250_000);
    case "PREMIUM":
    default:
      return fromEnv("AI_TOKEN_BUDGET_PREMIUM", 800_000);
  }
}

function isHardBudgetEnabled(): boolean {
  return process.env.AI_TOKEN_BUDGET_HARD?.trim() === "1";
}

export async function getAiTokenBudgetUsed(userId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const raw = await redis.get<number | string>(redisKey(userId));
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function checkAiTokenBudget(input: {
  userId: string;
  userPlan?: string | null;
  email?: string | null;
  isInfluencer?: boolean;
  /** Tokens previstos nesta chamada (opcional). */
  upcomingTokens?: number;
}): Promise<TokenBudgetCheck> {
  const limit = dailyTokenLimitForPlan(
    input.userPlan,
    input.email,
    input.isInfluencer,
  );
  const hard = isHardBudgetEnabled();
  const redis = getRedis();

  if (!Number.isFinite(limit)) {
    return {
      allowed: true,
      used: 0,
      limit,
      remaining: Number.POSITIVE_INFINITY,
      hard,
      failOpen: !redis,
    };
  }

  if (!redis) {
    return {
      allowed: true,
      used: 0,
      limit,
      remaining: limit,
      hard,
      failOpen: true,
    };
  }

  const used = await getAiTokenBudgetUsed(input.userId);
  const upcoming = Math.max(0, input.upcomingTokens ?? 0);
  const remaining = Math.max(0, limit - used);
  const over = used + upcoming > limit;

  if (over && hard) {
    return { allowed: false, used, limit, remaining, hard, failOpen: false };
  }

  if (over) {
    logger.warn("ai_token_budget: soft limit excedido", {
      feature: "ai-orchestrator",
      userId: input.userId.slice(0, 8),
      used,
      limit,
      hard: false,
    });
  } else if (used >= limit * 0.8) {
    logger.info("ai_token_budget: 80% do teto diário", {
      feature: "ai-orchestrator",
      userId: input.userId.slice(0, 8),
      used,
      limit,
    });
  }

  return {
    allowed: true,
    used,
    limit,
    remaining,
    hard,
    failOpen: false,
  };
}

/** Incrementa contador diário (TTL ~2 dias). */
export async function recordAiTokenBudget(
  userId: string,
  totalTokens: number,
): Promise<void> {
  if (!userId || !Number.isFinite(totalTokens) || totalTokens <= 0) return;
  const redis = getRedis();
  if (!redis) return;
  const key = redisKey(userId);
  try {
    const next = await redis.incrby(key, Math.round(totalTokens));
    if (next === Math.round(totalTokens)) {
      await redis.expire(key, 60 * 60 * 48);
    }
  } catch (error) {
    logger.warn("ai_token_budget: falha ao gravar", {
      feature: "ai-orchestrator",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
