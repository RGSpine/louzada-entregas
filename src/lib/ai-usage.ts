/**
 * Telemetria de uso de LLM (Fase B do orquestrador).
 * Log estruturado — sem UI; sem PII no payload.
 */

import type { GenerateContentResult } from "@google/generative-ai";
import { logger } from "@/lib/logger";

export type AiUsageSurface = "pro" | "patient";

export type AiUsageService =
  | "b2c_intake"
  | "b2c_manager"
  | "b2c_chat_reply"
  | "b2c_evidence"
  | "semantic_cache_hit"
  | "evolution_transcribe"
  | "evolution_structure"
  | "ester_analyze"
  | "ester_reply"
  | "ester_evidence"
  | "document_extract"
  | "document_draft"
  | "agenda_extract"
  | "finance_extract"
  | "other";

export type AiUsageEvent = {
  service: AiUsageService;
  model: string;
  surface?: AiUsageSurface;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  /** Quando informado (B2B), alimenta orçamento diário Redis. */
  userId?: string | null;
  /** Metadados não sensíveis (pipeline, risk, cache score). */
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export function extractGeminiUsage(result: GenerateContentResult): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  try {
    const usage = result.response.usageMetadata;
    return {
      inputTokens:
        typeof usage?.promptTokenCount === "number"
          ? usage.promptTokenCount
          : null,
      outputTokens:
        typeof usage?.candidatesTokenCount === "number"
          ? usage.candidatesTokenCount
          : null,
      totalTokens:
        typeof usage?.totalTokenCount === "number"
          ? usage.totalTokenCount
          : null,
    };
  } catch {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
}

/** Emite evento `ai_usage` para logs / agregação futura. */
export function logAiUsage(event: AiUsageEvent): void {
  logger.info("ai_usage", {
    feature: "ai-usage",
    service: event.service,
    model: event.model,
    surface: event.surface ?? null,
    inputTokens: event.inputTokens ?? null,
    outputTokens: event.outputTokens ?? null,
    totalTokens: event.totalTokens ?? null,
    ...(event.meta ?? {}),
  });

  const tokens = event.totalTokens ?? 0;
  if (event.userId && tokens > 0 && event.surface === "pro") {
    void import("@/lib/ai-orchestrator/token-budget")
      .then(({ recordAiTokenBudget }) =>
        recordAiTokenBudget(event.userId!, tokens),
      )
      .catch(() => {
        /* ignore */
      });
  }
}

export function logGeminiUsage(
  result: GenerateContentResult,
  opts: {
    service: AiUsageService;
    model: string;
    surface?: AiUsageSurface;
    userId?: string | null;
    meta?: AiUsageEvent["meta"];
  },
): void {
  const usage = extractGeminiUsage(result);
  logAiUsage({
    service: opts.service,
    model: opts.model,
    surface: opts.surface,
    userId: opts.userId,
    ...usage,
    meta: opts.meta,
  });
}
