/**
 * Pré-processamento multimodal do Agente Financeiro.
 *
 * DeepSeek-v4-flash é texto puro (sem visão/áudio nativos). Esta camada usa o
 * Gemini Flash apenas para converter ÁUDIO → transcrição e FOTO/PDF → OCR,
 * devolvendo texto cru e fiel (sem interpretação financeira). O raciocínio é
 * 100% do DeepSeek na etapa seguinte.
 */
import type { Part } from "@google/generative-ai";
import {
  generateContentSafeWithModelFallback,
  getAudioMultimodalModelIds,
} from "@/lib/gemini";

export type AgentMediaInput = {
  audio?: { mimeType: string; base64: string } | null;
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
};

const TRANSCRIBE_SYSTEM = `
És um transcritor literal. Não interpretas nem resumes.
- Para ÁUDIO: transcreve exatamente o que foi dito, em português, mantendo números e valores.
- Para IMAGENS/PDF (comprovantes, recibos, notas): extrai TODO o texto visível por OCR, preservando valores, datas e nomes.
Devolve apenas texto puro, sem comentários, sem Markdown.
`.trim();

/**
 * Converte mídia (áudio/imagens) num bloco de texto cru para o DeepSeek raciocinar.
 * Retorna string vazia se não houver mídia.
 */
export async function transcribeAgentMedia(input: AgentMediaInput): Promise<string> {
  const audio = input.audio?.base64 ? input.audio : null;
  const images = (input.images ?? []).filter((i) => i.base64);

  if (!audio && images.length === 0) return "";

  const parts: Part[] = [
    {
      text: "Transcreve o áudio e/ou extrai por OCR o texto dos ficheiros a seguir. Só texto puro.",
    },
  ];

  if (audio) {
    parts.push({ inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 } });
    parts.push({ text: "(áudio acima — transcrição literal)" });
  }

  if (images.length > 0) {
    parts.push({ text: "Ficheiros para OCR:" });
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  const { result } = await generateContentSafeWithModelFallback(
    {
      systemInstruction: TRANSCRIBE_SYSTEM,
      generationConfig: { temperature: 0 },
    },
    parts,
    120_000,
    getAudioMultimodalModelIds(),
  );

  const text = result.response.text();
  return typeof text === "string" ? text.trim() : "";
}
