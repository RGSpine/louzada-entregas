import type { Part } from "@google/generative-ai";
import {
  generateContentSafeWithModelFallback,
  getAudioMultimodalModelIds,
  isRetryableOverloadError,
  isTimeoutLikeError,
} from "@/lib/gemini";
import { generateTextWithDeepSeek, isDeepSeekConfigured } from "@/lib/deepseek";
import { evolutionTranscribePhaseTimeoutMs } from "@/lib/evolution-long-audio";
import { logger } from "@/lib/logger";
import { CLINICAL_DEEPSEEK_SAMPLING, clinicalGenerationConfig } from "@/lib/clinical-harness";

const TRANSCRIBE_PROMPT =
  "Transcreva integralmente o áudio em português brasileiro (pt-BR), linguagem clínica quando aplicável. " +
  "Não resuma. Não invente dados que não estejam no áudio. " +
  "Transcrição literal: siglas e nomes de métodos exatamente como pronunciados (não expanda siglas). " +
  "Trecho inaudível ou frase interrompida: escreva [inaudível] ou pare onde a fala parou — nunca complete a frase. " +
  "Não inclua título de documento (ex.: EVOLUÇÃO FISIOTERAPÊUTICA) nem bloco de IDENTIFICAÇÃO com dados demográficos — apenas o relato clínico. " +
  "Devolva apenas o texto da transcrição, sem JSON.";

/**
 * Fase 1: só transcrição com modelos Flash (carga menor que evolução completa multimodal).
 */
export async function transcribeEvolutionAudioWithGeminiFlash(
  audioPart: Part,
  timeoutMs: number,
): Promise<string> {
  const { result, modelUsed } = await generateContentSafeWithModelFallback(
    { generationConfig: clinicalGenerationConfig({ maxOutputTokens: 8192 }) },
    [{ text: TRANSCRIBE_PROMPT }, audioPart],
    timeoutMs,
    getAudioMultimodalModelIds(),
  );
  const text = result.response.text().trim();
  if (text.length < 8) {
    throw new Error("Transcrição do áudio vazia ou demasiado curta.");
  }
  logger.info("evolution-llm-fallback: transcrição Flash OK", {
    feature: "evolution-llm-fallback",
    modelUsed,
    chars: text.length,
  });
  return text;
}

function partsAreTextOnly(parts: Part[]): boolean {
  return parts.every((p) => "text" in p && p.text !== undefined && !("inlineData" in p && p.inlineData));
}

/**
 * Fase 2: estruturar JSON a partir da transcrição (sem reenviar áudio).
 * Com anexos visuais/PDF usa Gemini multimodal; só texto pode usar DeepSeek.
 */
export async function structureEvolutionJsonFromParts(
  systemInstruction: string,
  parts: Part[],
  timeoutMs: number,
): Promise<string> {
  if (partsAreTextOnly(parts) && isDeepSeekConfigured()) {
    try {
      const userText = parts
        .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n\n");
      const text = await generateTextWithDeepSeek({
        systemInstruction,
        userPrompt: userText,
        timeoutMs,
        maxTokens: 8192,
        ...CLINICAL_DEEPSEEK_SAMPLING,
      });
      logger.info("evolution-llm-fallback: JSON via DeepSeek", {
        feature: "evolution-llm-fallback",
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      });
      return text;
    } catch (deepErr) {
      logger.warn("evolution-llm-fallback: DeepSeek falhou; tenta Gemini", {
        feature: "evolution-llm-fallback",
        detail: deepErr instanceof Error ? deepErr.message : String(deepErr),
      });
    }
  }

  const { result, modelUsed } = await generateContentSafeWithModelFallback(
    {
      systemInstruction,
      generationConfig: clinicalGenerationConfig({ maxOutputTokens: 8192 }),
    },
    parts,
    timeoutMs,
    getAudioMultimodalModelIds(),
  );
  logger.info("evolution-llm-fallback: JSON via Gemini", {
    feature: "evolution-llm-fallback",
    modelUsed,
  });
  return result.response.text();
}

export function shouldTryEvolutionTwoPhaseFallback(err: unknown): boolean {
  return isRetryableOverloadError(err) || isTimeoutLikeError(err);
}

export type EvolutionTwoPhaseInput = {
  systemInstruction: string;
  prompt: string;
  audioPart: Part;
  examFileParts: Part[];
  multimodalTimeoutMs: number;
};

/**
 * Pipeline 2 fases: transcrever áudio → estruturar JSON (sem reenviar áudio ao modelo).
 * Mais fiável para consultas longas (>4 min).
 * Alinha ao orquestrador: extract econômico (Flash) → draft estruturado sem áudio bruto no Pro.
 */
export async function generateEvolutionResponseViaTwoPhase(
  input: EvolutionTwoPhaseInput,
): Promise<{ text: string; transcript: string }> {
  const { assertNoRawAudioOnAdvancedRoute } = await import(
    "@/lib/ai-orchestrator/pipeline"
  );
  assertNoRawAudioOnAdvancedRoute({
    hasRawAudio: true,
    route: "Modelo_Economico",
    stage: "extract",
  });

  const transcribeTimeout = evolutionTranscribePhaseTimeoutMs(input.multimodalTimeoutMs);
  const transcript = await transcribeEvolutionAudioWithGeminiFlash(
    input.audioPart,
    transcribeTimeout,
  );
  const phase2Parts: Part[] = [
    {
      text: `${input.prompt}\n\n--- TRANSCRIÇÃO DO ÁUDIO (fonte primária para technicalTranscription e campos extraídos) ---\n${transcript}`,
    },
    ...input.examFileParts,
  ];
  const text = await structureEvolutionJsonFromParts(
    input.systemInstruction,
    phase2Parts,
    input.multimodalTimeoutMs,
  );
  return { text, transcript };
}
