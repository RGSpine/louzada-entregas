/**
 * Configuração central do Google Gemini para todo o sistema EvoluAI.
 *
 * MODELO PADRÃO (Pro): gemini-2.5-pro
 * MODELO RÁPIDO (Flash): gemini-2.5-flash
 *
 * Para sobrescrever sem alterar código, defina no .env:
 *   GEMINI_MODEL=<outro-modelo>
 *   GEMINI_FAST_MODEL=<outro-modelo-flash>
 *   GEMINI_MULTIMODAL_FALLBACKS=modeloA,modeloB  (evolução/anexos: tenta em cadeia se o principal falhar)
 *   GEMINI_DOCUMENT_MERGE_MODEL=gemini-2.5-flash  (prioridade ao processar só anexos no rascunho do documento)
 *   GEMINI_EVOLUTION_JSON_MIME=1  (força application/json na resposta da evolução — opcional)
 *
 * Este arquivo é o ÚNICO lugar onde os modelos são definidos.
 * Todos os outros módulos devem importar daqui.
 *
 * Distribuição de modelos:
 *
 * PRO (getGeminiModel):
 *   - Evoluções clínicas (ai.ts → generateEvolution)
 *   - Extração de métricas (metrics/generate)
 *   - Geração de documentos com templates (generated-documents.ts)
 *
 * FLASH (getGeminiFastModel):
 *   - Revisão na geração de documentos (generated-documents.ts → reviseClinicalDocumentDraft: Flash ou Pro conforme templates / evoluções)
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  type GenerativeModel,
  type ModelParams,
  type GenerateContentResult,
  type Part,
} from "@google/generative-ai";

/** Tentativas máximas quando a API devolve 429/503 (sobrecarga / indisponibilidade). */
const OVERLOAD_MAX_ATTEMPTS = 5;

/** Erro 429/503 ou equivalente — candidato a próximo modelo na cadeia multimodal. */
export function isRetryableOverloadError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const s = err.status;
    if (s === 429 || s === 503) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /429|503|Service Unavailable|Too Many Requests|high demand|RESOURCE_EXHAUSTED|resource exhausted/i.test(
    msg,
  );
}

function overloadBackoffMs(zeroBasedAttempt: number): number {
  const cap = 20_000;
  const base = 1500;
  return Math.min(cap, base * 2 ** zeroBasedAttempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Gemini v1beta: cada elemento de `parts` tem de ser `{ text }` ou `{ inlineData }`, nunca string solta.
 * Sem isto a API devolve 400 em contents[0].parts[0].
 */
function normalizeUserContentPartsToParts(content: string | Part[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  const out: Part[] = [];
  for (const p of content) {
    if (typeof p === "string") {
      out.push({ text: p });
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Modelo padrão (Pro) do sistema — estável em produção (evitar preview só em env explícito). */
export const GEMINI_MODEL: string =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";

/** Modelo rápido (Flash) para tarefas leves — revisão de texto, resumos. */
export const GEMINI_FAST_MODEL: string =
  process.env.GEMINI_FAST_MODEL?.trim() || "gemini-2.5-flash";

function requireApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada. Defina a chave da API Gemini no .env para usar as features de IA."
    );
  }
  return apiKey;
}

/**
 * Retorna uma instância configurada do Gemini Pro.
 */
export function getGeminiModel(params?: Omit<ModelParams, "model">): GenerativeModel {
  const genAI = new GoogleGenerativeAI(requireApiKey());
  return genAI.getGenerativeModel({ model: GEMINI_MODEL, ...params });
}

/**
 * Retorna uma instância do Gemini Flash (mais rápido e barato)
 * para tarefas como revisão de texto e resumos clínicos.
 */
export function getGeminiFastModel(params?: Omit<ModelParams, "model">): GenerativeModel {
  const genAI = new GoogleGenerativeAI(requireApiKey());
  return genAI.getGenerativeModel({ model: GEMINI_FAST_MODEL, ...params });
}

/** IDs que a API Google já não expõe (404) — removidos de qualquer cadeia, mesmo vindo do .env. */
const DEPRECATED_GEMINI_MODEL_IDS = new Set(["gemini-2.0-flash", "gemini-2.0-flash-exp"]);

function filterKnownBadGeminiModelIds(ids: string[]): string[] {
  return ids.filter((id) => !DEPRECATED_GEMINI_MODEL_IDS.has(id));
}

/**
 * Ordem de modelos para pedidos multimodais (imagem/PDF/áudio).
 * Útil quando GEMINI_MODEL é um preview indisponível para a chave ou região.
 * Sobrescrever: GEMINI_MULTIMODAL_FALLBACKS=gemini-2.5-pro,gemini-2.5-flash
 */
export function getMultimodalModelCandidateIds(): string[] {
  const fromEnv =
    process.env.GEMINI_MULTIMODAL_FALLBACKS?.split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0) ?? [];
  const builtIn = ["gemini-2.5-pro", "gemini-2.5-flash"];
  const ordered = [GEMINI_MODEL, ...fromEnv, ...builtIn];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ordered) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return filterKnownBadGeminiModelIds(out);
}

/**
 * Áudio na evolução: Flash primeiro (menos 503 em demo; Pro só depois).
 */
export function getAudioMultimodalModelIds(): string[] {
  const flashFirst = [GEMINI_FAST_MODEL, "gemini-2.5-flash", "gemini-2.5-pro", GEMINI_MODEL];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of flashFirst) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of getMultimodalModelCandidateIds()) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return filterKnownBadGeminiModelIds(out);
}

/**
 * Ordem para «Gerar documento → Processar anexos»: Flash primeiro (latência baixa;
 * em Vercel Hobby o limite de duração é curto e o Pro preview pode não responder a tempo).
 * Sobrescrever: GEMINI_DOCUMENT_MERGE_MODEL=gemini-2.5-flash
 */
export function getDocumentMergeVisionModelIds(): string[] {
  const custom = process.env.GEMINI_DOCUMENT_MERGE_MODEL?.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [custom, GEMINI_FAST_MODEL, ...getMultimodalModelCandidateIds()]) {
    if (id && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return filterKnownBadGeminiModelIds(out);
}

/** 404/400 de modelo inválido ou endpoint errado — tentar próximo ID na cadeia multimodal. */
function isLikelyWrongModelOrEndpointError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 404) return true;
    if (err.status === 400) {
      const m = (err.message || "").toLowerCase();
      if (
        m.includes("model") &&
        (m.includes("not found") ||
          m.includes("invalid") ||
          m.includes("not supported") ||
          m.includes("does not exist") ||
          m.includes("was not found"))
      ) {
        return true;
      }
    }
  }
  const m = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    /model.*not found|not a valid model|invalid model|unknown model|does not exist|was not found|no matching route/i.test(
      m,
    ) && /model|gemini|generatecontent/i.test(m)
  );
}

export function isTimeoutLikeError(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err);
  return /timeout após|timeout after|timed out|deadline exceeded|ETIMEDOUT/i.test(m);
}

/**
 * Tenta `generateContentSafe` com vários IDs de modelo até um funcionar.
 * Retorna o resultado e o modelo usado (útil para logs).
 */
export async function generateContentSafeWithModelFallback(
  sharedParams: Omit<ModelParams, "model">,
  content: string | Part[],
  timeoutMs: number,
  candidateModelIds?: string[],
): Promise<{ result: GenerateContentResult; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(requireApiKey());
  const ids =
    candidateModelIds && candidateModelIds.length > 0
      ? candidateModelIds
      : getMultimodalModelCandidateIds();
  let lastError: unknown;
  for (let i = 0; i < ids.length; i++) {
    const modelId = ids[i]!;
    try {
      const model = genAI.getGenerativeModel({ model: modelId, ...sharedParams });
      const result = await generateContentSafe(model, content, timeoutMs, 1);
      if (i > 0) {
        console.warn(
          `[Gemini] Multimodal: modelo anterior indisponível; sucesso com "${modelId}".`,
        );
      }
      return { result, modelUsed: modelId };
    } catch (err) {
      lastError = err;
      const tryNext =
        i < ids.length - 1 &&
        (isLikelyWrongModelOrEndpointError(err) ||
          isTimeoutLikeError(err) ||
          isRetryableOverloadError(err));
      if (tryNext) {
        console.warn(
          `[Gemini] Modelo "${modelId}" falhou no multimodal; a tentar próximo:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function generateContentOnce(
  model: GenerativeModel,
  content: string | Part[],
  timeoutMs: number,
): Promise<GenerateContentResult> {
  const parts = normalizeUserContentPartsToParts(content);
  const payload = {
    contents: [
      {
        role: "user" as const,
        parts,
      },
    ],
  };
  const pending = model.generateContent(payload);
  if (timeoutMs <= 0) return pending;
  const timeoutReject = new Promise<GenerateContentResult>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout após ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([pending, timeoutReject]);
}

/**
 * Até OVERLOAD_MAX_ATTEMPTS tentativas com backoff exponencial só para 429/503 (e mensagens equivalentes).
 */
async function generateContentWithOverloadRetries(
  model: GenerativeModel,
  content: string | Part[],
  timeoutMs: number,
): Promise<GenerateContentResult> {
  let lastError: unknown;
  for (let i = 0; i < OVERLOAD_MAX_ATTEMPTS; i++) {
    try {
      return await generateContentOnce(model, content, timeoutMs);
    } catch (err) {
      lastError = err;
      const canRetryOverload = isRetryableOverloadError(err) && i < OVERLOAD_MAX_ATTEMPTS - 1;
      if (canRetryOverload) {
        await sleep(overloadBackoffMs(i));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Wrapper para model.generateContent: retries agressivos com backoff para 429/503;
 * para outros erros, até `genericRetries` tentativas adicionais com espera curta (comportamento anterior).
 */
export async function generateContentSafe(
  model: GenerativeModel,
  content: string | Part[],
  timeoutMs = 60_000,
  genericRetries = 1,
): Promise<GenerateContentResult> {
  let lastError: unknown;
  for (let g = 0; g <= genericRetries; g++) {
    try {
      return await generateContentWithOverloadRetries(model, content, timeoutMs);
    } catch (err) {
      lastError = err;
      if (g < genericRetries && !isRetryableOverloadError(err)) {
        await sleep(1000 * (g + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Verifica se o Gemini está configurado (API key presente).
 */
export function isGeminiConfigured(): boolean {
  return typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
}
