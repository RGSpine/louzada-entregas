/**
 * Contrato extract → validate → draft (laudos, docs, evoluções).
 * Nunca redigir com Modelo_Avancado antes da validação estrutural.
 */

import type { ZodTypeAny } from "zod";
import type { PipelineStage } from "./types";

export type ExtractValidateDraftResult<T> =
  | { ok: true; data: T; stages: PipelineStage[] }
  | { ok: false; error: string; stages: PipelineStage[] };

/**
 * Valida JSON/objeto extraído com Zod antes da redação final.
 */
export function validateExtractedStructure<T>(
  schema: ZodTypeAny,
  raw: unknown,
): ExtractValidateDraftResult<T> {
  const stages: PipelineStage[] = ["extract", "validate"];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Estrutura inválida",
      stages,
    };
  }
  return { ok: true, data: parsed.data as T, stages };
}

/**
 * Guarda de produto: extract com áudio bruto só na rota econômica (Flash/STT).
 * Pro (Modelo_Avancado) recebe texto já filtrado na fase draft.
 */
export function assertNoRawAudioOnAdvancedRoute(opts: {
  hasRawAudio: boolean;
  route: "Modelo_Economico" | "Modelo_Avancado" | "zero_llm";
  stage: PipelineStage;
}): void {
  if (!opts.hasRawAudio) return;
  if (opts.stage === "extract" && opts.route !== "Modelo_Economico") {
    throw new Error(
      "Orquestrador: extract com áudio bruto exige Modelo_Economico (Flash/STT). Pro só no draft textual.",
    );
  }
  if (opts.stage === "draft" && opts.route === "Modelo_Avancado") {
    throw new Error(
      "Orquestrador: draft no Modelo_Avancado não pode incluir áudio bruto — envie só texto/JSON validado.",
    );
  }
}
