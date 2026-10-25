/**
 * Orquestrador de IA — entrada única (Fase C).
 *
 * B2C continua em `@/lib/b2c/*`; este barrel reexporta o essencial
 * e adiciona risco pro, rotas de modelo, pipeline e orçamento de tokens.
 */

export type {
  OrchestratorSurface,
  OrchestratorRisk,
  ModelRoute,
  PipelineStage,
  OrchestratorDecisionBase,
} from "./types";

export {
  classifyProOrchestratorRisk,
  PRO_EMERGENCY_HINT,
  type ProOrchestratorDecision,
  type ProOrchestratorIntent,
} from "./pro-risk";

export { modelIdForRoute, getGenerativeModelForRoute } from "./model-route";

export {
  validateExtractedStructure,
  assertNoRawAudioOnAdvancedRoute,
  type ExtractValidateDraftResult,
} from "./pipeline";

export {
  dailyTokenLimitForPlan,
  checkAiTokenBudget,
  recordAiTokenBudget,
  getAiTokenBudgetUsed,
  type TokenBudgetCheck,
} from "./token-budget";

/** Reexports B2C (paciente) para um único import path. */
export { classifyB2cOrchestratorRisk } from "@/lib/b2c/orchestrator-risk";
export { searchSemanticCache, putSemanticCache } from "@/lib/b2c/semantic-cache";
export {
  logAiUsage,
  logGeminiUsage,
  extractGeminiUsage,
  type AiUsageService,
  type AiUsageEvent,
} from "@/lib/ai-usage";
