import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, type AuthFailureReason } from "@/lib/auth/request-auth";
import type { AuthenticatedContext } from "@/lib/auth/session-user";
import {
  aiBillingRateLimitMessage,
  enforceAiBillingRateLimit,
} from "@/lib/ai-billing-rate-limit";
import { getRequestClientIp } from "@/lib/request-client-ip";
import { enforceRateLimit, type RateLimitConfig } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const API_V1_VERSION = "1.0.0";

type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    apiVersion: typeof API_V1_VERSION;
  };
};

type ApiSuccessBody<T> = {
  ok: true;
  data: T;
  meta: {
    apiVersion: typeof API_V1_VERSION;
  };
};

const AUTH_MESSAGES: Record<AuthFailureReason, { code: string; message: string; status: number }> =
  {
    missing_credentials: {
      code: "UNAUTHORIZED",
      message: "Não autenticado. Faça login para continuar.",
      status: 401,
    },
    invalid_token: {
      code: "INVALID_TOKEN",
      message: "Token inválido ou expirado.",
      status: 401,
    },
    user_not_found: {
      code: "USER_NOT_FOUND",
      message: "Conta não encontrada.",
      status: 401,
    },
    account_blocked: {
      code: "ACCOUNT_BLOCKED",
      message: "Conta bloqueada. Entre em contato com o suporte.",
      status: 403,
    },
    access_limit_exceeded: {
      code: "ACCESS_LIMIT_EXCEEDED",
      message: "Limite de sessões simultâneas atingido. Encerre outro dispositivo para continuar.",
      status: 403,
    },
    access_session_invalid: {
      code: "ACCESS_SESSION_INVALID",
      message: "Sessão de acesso inválida ou expirada. Faça login novamente.",
      status: 401,
    },
    checkout_required: {
      code: "CHECKOUT_REQUIRED",
      message:
        "Conclua a escolha do plano e o pagamento para usar o sistema.",
      status: 403,
    },
  };

export function apiV1Ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json(
    {
      ok: true as const,
      data,
      meta: { apiVersion: API_V1_VERSION },
    },
    init,
  );
}

export function apiV1Error(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: { apiVersion: API_V1_VERSION },
    },
    { status },
  );
}

export function apiV1AuthError(reason: AuthFailureReason): NextResponse<ApiErrorBody> {
  const mapped = AUTH_MESSAGES[reason];
  logger.warn("API v1: autenticação recusada", {
    feature: "api/v1",
    reason,
  });
  return apiV1Error(mapped.code, mapped.message, mapped.status);
}

export async function requireApiV1Auth(
  request: NextRequest,
  rateLimit: RateLimitConfig,
  feature: string,
): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return { ok: false, response: apiV1AuthError(auth.reason) };
  }

  const rateKey = auth.ctx.email
    ? `${feature}:${auth.ctx.email}`
    : `${feature}:${auth.ctx.dbUser.id}`;

  const rl = await enforceRateLimit(rateKey, rateLimit);
  if (!rl.allowed) {
    return {
      ok: false,
      response: apiV1Error(
        "RATE_LIMITED",
        `Muitas requisições. Tente novamente em ${rl.resetIn}s.`,
        429,
      ),
    };
  }

  return { ok: true, ctx: auth.ctx };
}

/** Auth API v1 sem rate limit (quando o handler/service já aplica billing limit). */
export async function requireApiV1Session(
  request: NextRequest,
): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return { ok: false, response: apiV1AuthError(auth.reason) };
  }
  return { ok: true, ctx: auth.ctx };
}

/**
 * Auth API v1 + rate limit anti billing-abuse (minuto + hora, IP + usuário).
 * Usar em rotas que disparam chamadas a LLMs.
 */
export async function requireApiV1AiAuth(
  request: NextRequest,
  feature: string,
): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return { ok: false, response: apiV1AuthError(auth.reason) };
  }

  const userKey = auth.ctx.email?.toLowerCase() || auth.ctx.dbUser.id;
  const rl = await enforceAiBillingRateLimit({
    userKey,
    ip: getRequestClientIp(request.headers),
  });
  if (!rl.allowed) {
    logger.warn("API v1: rate limit IA excedido", { feature });
    return {
      ok: false,
      response: apiV1Error("RATE_LIMITED", aiBillingRateLimitMessage(rl.resetIn), 429),
    };
  }

  return { ok: true, ctx: auth.ctx };
}
