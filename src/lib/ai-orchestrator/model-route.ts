/**
 * Mapeia rotas do protocolo → factories Gemini do projeto.
 */

import {
  getGeminiFastModel,
  getGeminiModel,
  GEMINI_FAST_MODEL,
  GEMINI_MODEL,
} from "@/lib/gemini";
import type { GenerativeModel, ModelParams } from "@google/generative-ai";
import type { ModelRoute } from "./types";

export function modelIdForRoute(route: ModelRoute): string {
  switch (route) {
    case "Modelo_Avancado":
      return GEMINI_MODEL;
    case "Modelo_Economico":
      return GEMINI_FAST_MODEL;
    case "zero_llm":
      return "none";
  }
}

export function getGenerativeModelForRoute(
  route: ModelRoute,
  params?: Omit<ModelParams, "model">,
): GenerativeModel | null {
  if (route === "zero_llm") return null;
  if (route === "Modelo_Avancado") {
    return getGeminiModel(params);
  }
  return getGeminiFastModel(params);
}
