/**
 * Sanitização de HTML/XSS — usada antes de salvar conteúdo gerado por
 * usuário ou retornado pela IA no banco de dados.
 *
 * Usa regex leve em vez de DOMPurify/jsdom para evitar cold-start pesado
 * em ambientes serverless (Vercel). Para o uso atual (campos clínicos
 * que NUNCA renderizam HTML), a remoção completa de tags é suficiente.
 */

const STRIP_TAGS = /<\/?[^>]+(>|$)/g;
const DECODE_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&nbsp;": " ",
};
const ENTITY_RE = /&(?:amp|lt|gt|quot|#39|#x27|#x2F|nbsp);/gi;

function decodeEntities(input: string): string {
  return input.replace(ENTITY_RE, (match) => DECODE_ENTITIES[match.toLowerCase()] ?? match);
}

/**
 * Remove todas as tags HTML e decodifica entidades comuns.
 * Resultado: texto puro — adequado para campos clínicos que não
 * devem renderizar HTML (evoluções, diagnósticos, etc.).
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input.replace(STRIP_TAGS, "")).trim();
}

/**
 * Remove tags perigosas (script, iframe, event handlers) mas mantém
 * formatação básica (b, i, em, strong, p, br, ul, ol, li, h1-h3).
 */
export function sanitizeRichText(input: string | null | undefined): string {
  if (!input) return "";
  const noScripts = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
  const ALLOWED = /^\/?(b|i|em|strong|p|br|ul|ol|li|h[1-3])(\s|>|\/)/i;
  return noScripts.replace(/<\/?([^>]+)>/g, (tag, inner) => {
    return ALLOWED.test(inner.trim()) ? tag : "";
  });
}
