/**
 * DeepSeek (API OpenAI-compatível) — fallback de texto quando o Gemini falha.
 * Não suporta áudio nativo: usar após transcrição via Gemini Flash ou texto existente.
 *
 * Env:
 *   DEEPSEEK_API_KEY
 *   DEEPSEEK_MODEL=deepseek-v4-flash  (ou deepseek-chat)
 *   DEEPSEEK_API_BASE=https://api.deepseek.com/v1  (opcional)
 */

const DEFAULT_BASE = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-v4-flash";

export function isDeepSeekConfigured(): boolean {
  return (
    typeof process.env.DEEPSEEK_API_KEY === "string" &&
    process.env.DEEPSEEK_API_KEY.trim().length > 0
  );
}

function requireDeepSeekKey(): string {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY não configurada.");
  }
  return key;
}

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
}

export type DeepSeekChatOptions = {
  systemInstruction?: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** "high" | "max" ativam o modo de raciocínio do V4; omitir = modo rápido (não-thinking). */
  reasoningEffort?: "high" | "max";
  /** Força resposta JSON estrita (response_format json_object). */
  jsonMode?: boolean;
};

export type DeepSeekUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type DeepSeekDetailedResult = {
  text: string;
  model: string;
  usage: DeepSeekUsage;
};

/**
 * Chat completion com usage (telemetria). Compatível com API OpenAI v1.
 */
export async function generateTextWithDeepSeekDetailed(
  options: DeepSeekChatOptions,
): Promise<DeepSeekDetailedResult> {
  const apiKey = requireDeepSeekKey();
  const base = process.env.DEEPSEEK_API_BASE?.trim() || DEFAULT_BASE;
  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const model = getDeepSeekModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (options.systemInstruction?.trim()) {
      messages.push({ role: "system", content: options.systemInstruction.trim() });
    }
    messages.push({ role: "user", content: options.userPrompt });

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.2,
      ...(options.topP != null ? { top_p: options.topP } : {}),
    };
    if (options.jsonMode) {
      requestBody.response_format = { type: "json_object" };
    }
    if (options.reasoningEffort) {
      // V4: parâmetro OpenAI-compatível para ativar modos de raciocínio.
      requestBody.reasoning_effort = options.reasoningEffort;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    if (!res.ok) {
      const detail =
        typeof body.error?.message === "string"
          ? body.error.message
          : `HTTP ${res.status}`;
      throw new Error(`[DeepSeek ${res.status}] ${detail}`);
    }

    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("DeepSeek devolveu resposta vazia.");
    }
    return {
      text,
      model,
      usage: {
        promptTokens:
          typeof body.usage?.prompt_tokens === "number"
            ? body.usage.prompt_tokens
            : null,
        completionTokens:
          typeof body.usage?.completion_tokens === "number"
            ? body.usage.completion_tokens
            : null,
        totalTokens:
          typeof body.usage?.total_tokens === "number"
            ? body.usage.total_tokens
            : null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat completion (texto). Compatível com API OpenAI v1.
 */
export async function generateTextWithDeepSeek(
  options: DeepSeekChatOptions,
): Promise<string> {
  const result = await generateTextWithDeepSeekDetailed(options);
  return result.text;
}
