import type { Part } from "@google/generative-ai";

import {
  generateContentSafeWithModelFallback,
  getAudioMultimodalModelIds,
  isGeminiConfigured,
} from "@/lib/gemini";
import { clinicalGenerationConfig } from "@/lib/clinical-harness";

const LOGISTICS_TRANSCRIBE_SYSTEM = `
És um transcritor literal de comandos de coleta e entrega de um laboratório de prótese.
- Transcreve palavra por palavra, em português, exatamente o que foi dito.
- Mantém nomes de dentistas, clínicas, datas, horas e as palavras coletar, entregar, até, hoje, ontem, amanhã.
- O que não der para entender: escreve [inaudível]. Não completes frase cortada nem adivinhes a palavra.
- Não interpretes, não resumes e não transformes o horário em número.
Devolve apenas texto puro, sem Markdown e sem introdução.
`.trim();

export async function transcribeLogisticsMedia(audio: {
  mimeType: string;
  base64: string;
}): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> {
  if (!audio.base64?.trim()) {
    return { ok: false, error: "O áudio chegou vazio." };
  }
  if (!isGeminiConfigured()) {
    return {
      ok: false,
      error: "Defina GEMINI_API_KEY no .env para transcrever o áudio. O comando digitado continua disponível.",
    };
  }

  const parts: Part[] = [
    { text: "Transcreve o áudio palavra por palavra. Só texto puro." },
    { inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 } },
    { text: "(áudio acima — transcrição literal, com [inaudível] onde falhar)" },
  ];

  const { result } = await generateContentSafeWithModelFallback(
    {
      systemInstruction: LOGISTICS_TRANSCRIBE_SYSTEM,
      generationConfig: clinicalGenerationConfig(),
    },
    parts,
    120_000,
    getAudioMultimodalModelIds(),
  );
  const text = result.response.text();
  const transcript = typeof text === "string" ? text.trim() : "";
  if (!transcript) return { ok: false, error: "Não foi possível transcrever o áudio." };
  return { ok: true, transcript };
}
