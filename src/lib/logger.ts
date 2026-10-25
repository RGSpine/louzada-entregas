/**
 * Logger estruturado para observabilidade (MELT-ready)
 *
 * - Em desenvolvimento: saída legível no console
 * - Em produção: JSON com timestamp, level, message e context (traceId, userId, feature)
 * - Permite correlacionar logs com traces (Sentry/OTLP) quando traceId for injetado
 *
 * Uso:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Usuário logou", { userId: "abc", feature: "auth" });
 *   logger.error("Falha na API", { error: err.message, traceId: "..." });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** ID do trace (Sentry/OTLP) para correlacionar com métricas e traces */
  traceId?: string;
  /** ID do span atual */
  spanId?: string;
  /** ID do usuário (quando disponível) */
  userId?: string;
  /** Nome da feature/fluxo (ex: "auth", "evolution", "api/evolution") */
  feature?: string;
  /** Duração em ms */
  durationMs?: number;
  /** Dados extras (evitar PII em produção) */
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (): LogLevel => {
  const env = process.env.NODE_ENV;
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (level && LOG_LEVELS[level] !== undefined) return level;
  return env === "production" ? "info" : "debug";
};

const levelValue = (): number => LOG_LEVELS[currentLevel()];

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    });
  }

  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const ctxStr = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `${prefix} ${message}${ctxStr}`;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  if (LOG_LEVELS[level] < levelValue()) return;
  const formatted = formatMessage(level, message, context);
  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => log("debug", message, context),
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),

  /** Cria um child logger com context fixo (ex: feature, userId) para encadear em uma requisição */
  child(defaultContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        log("debug", message, { ...defaultContext, ...context }),
      info: (message: string, context?: LogContext) =>
        log("info", message, { ...defaultContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        log("warn", message, { ...defaultContext, ...context }),
      error: (message: string, context?: LogContext) =>
        log("error", message, { ...defaultContext, ...context }),
    };
  },
};
