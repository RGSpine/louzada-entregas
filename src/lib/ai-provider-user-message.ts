/**
 * Mensagens amigáveis para falhas do provedor de IA (Gemini).
 * Evita expor stack ou texto bruto da API ao utilizador final.
 */

const MSG_OVERLOAD_OR_UNAVAILABLE =
  "O serviço de inteligência artificial está temporariamente indisponível ou sobrecarregado (Google Gemini). A aplicação tenta modelos alternativos automaticamente; aguarde um momento e tente de novo.";

const MSG_RATE_LIMIT =
  "O serviço de IA limitou o número de pedidos neste momento. Aguarde um pouco e tente novamente.";

const MSG_GENERIC_PROVIDER =
  "Não foi possível concluir o pedido junto do serviço de IA. A aplicação está a funcionar com normalidade; se o problema persistir, tente mais tarde.";

function normalizeToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  if (raw !== null && typeof raw === "object" && "error" in raw) {
    const e = (raw as { error: unknown }).error;
    return typeof e === "string" ? e : normalizeToString(e);
  }
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

/** Erros de negócio/regra da app — não substituir por mensagem genérica do provedor. */
function isAppBusinessRuleMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("limite do plano") ||
    m.includes("não autenticado") ||
    m.includes("nao autenticado") ||
    m.includes("dados inválidos") ||
    m.includes("dados invalidos") ||
    m.includes("paciente não encontrado") ||
    m.includes("paciente nao encontrado") ||
    m.includes("não encontrado") ||
    m.includes("nao encontrado") ||
    m.includes("plano free") ||
    m.includes("plano pro") ||
    m.includes("exclusiva do plano") ||
    m.includes("necessário plano") ||
    m.includes("necessario plano") ||
    m.includes("starter ou superior") ||
    m.includes("starter ou pro") ||
    m.includes("upgrade") ||
    m.includes("quota") ||
    m.includes("muitas requisições") ||
    m.includes("muitas requisicoes") ||
    (m.includes("rate limit") && m.includes("tente")) ||
    m.includes("não devolveu conteúdo") ||
    m.includes("nao devolveu conteudo") ||
    m.includes("resposta vazia") ||
    m.includes("formato reconhecível") ||
    m.includes("formato reconhecivel") ||
    m.includes("resposta inválida") ||
    m.includes("resposta invalida")
  );
}

function looksLikeTechnicalGeminiOrHttpError(msg: string): boolean {
  return (
    /GoogleGenerativeAI|GoogleGenerativeAIFetchError|generativelanguage\.googleapis/i.test(
      msg,
    ) ||
    /\[\s*503\s+|\[\s*429\s+|Error fetching from|Service Unavailable|Too Many Requests|high demand|RESOURCE_EXHAUSTED/i.test(
      msg,
    ) ||
    msg.length > 320
  );
}

function classifyProviderKind(msg: string): "overload" | "rate" | "generic" | null {
  const lower = msg.toLowerCase();
  if (
    msg.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("high demand")
  ) {
    return "overload";
  }
  if (
    msg.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted") ||
    lower.includes("resource exhausted")
  ) {
    return "rate";
  }
  if (looksLikeTechnicalGeminiOrHttpError(msg)) {
    return "generic";
  }
  return null;
}

/**
 * Converte erros técnicos do Gemini / rede em texto adequado ao utilizador.
 * Mensagens curtas e já em português da aplicação mantêm-se (exceto se forem claramente técnicas).
 */
export function formatAiProviderErrorForUser(raw: unknown): string {
  const msg = normalizeToString(raw).trim();
  if (!msg) return MSG_GENERIC_PROVIDER;
  if (isAppBusinessRuleMessage(msg)) return msg;

  const kind = classifyProviderKind(msg);
  if (kind === "overload") return MSG_OVERLOAD_OR_UNAVAILABLE;
  if (kind === "rate") return MSG_RATE_LIMIT;
  if (kind === "generic") return MSG_GENERIC_PROVIDER;

  if (msg.length > 200) return MSG_GENERIC_PROVIDER;
  return msg;
}
