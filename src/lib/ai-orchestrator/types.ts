/** Tipos compartilhados do Orquestrador (Fase C). */

export type OrchestratorSurface = "pro" | "patient";

export type OrchestratorRisk = "R0" | "R1" | "R2";

export type ModelRoute = "Modelo_Economico" | "Modelo_Avancado" | "zero_llm";

export type PipelineStage =
  | "classify"
  | "cache"
  | "extract"
  | "validate"
  | "draft"
  | "evidence"
  | "reply";

export type OrchestratorDecisionBase = {
  risk: OrchestratorRisk;
  route: ModelRoute;
  surface: OrchestratorSurface;
  /** Pular evidência externa (PubMed/Perplexity). */
  skipEvidence: boolean;
  /** Incluir blocos caros (vitrine / agenda-finance já têm gatilhos próprios). */
  wantsHeavyContext: boolean;
};
