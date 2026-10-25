/**
 * Transcrição literal do áudio/OCR do paciente (consulta e relato).
 * Separada do agente financeiro para não misturar o prompt de comprovantes
 * com a regra clínica de não completar o que não foi ouvido.
 */
import type { Part } from "@google/generative-ai";
import { clinicalGenerationConfig } from "@/lib/clinical-harness";
import {
  generateContentSafeWithModelFallback,
  getAudioMultimodalModelIds,
} from "@/lib/gemini";

export type PatientMediaInput = {
  audio?: { mimeType: string; base64: string } | null;
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
};

const PATIENT_TRANSCRIBE_SYSTEM = `
És um transcritor literal. Não interpretas, não resumes e não explicas.
- ÁUDIO: transcreve palavra por palavra, em português, exatamente o que foi dito. Mantém números, nomes e doses como soaram.
- O que não der para entender: escreve [inaudível]. Não completes frase cortada nem adivinhes a palavra.
- IMAGEM ou PDF: extrai só o texto visível (OCR), sem comentar o laudo.
Devolve apenas texto puro, sem Markdown e sem introdução.
`.trim();

export async function transcribePatientMedia(
  input: PatientMediaInput,
): Promise<string> {
  const audio = input.audio?.base64 ? input.audio : null;
  const images = (input.images ?? []).filter((image) => image.base64);
  if (!audio && images.length === 0) return "";

  const parts: Part[] = [
    {
      text: "Transcreve o áudio palavra por palavra e/ou extrai o texto visível dos arquivos. Só texto puro.",
    },
  ];
  if (audio) {
    parts.push({
      inlineData: { mimeType: audio.mimeType || "audio/webm", data: audio.base64 },
    });
    parts.push({ text: "(áudio acima — transcrição literal, com [inaudível] onde falhar)" });
  }
  if (images.length > 0) {
    parts.push({ text: "Arquivos para OCR:" });
    for (const image of images) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
    }
  }

  const { result } = await generateContentSafeWithModelFallback(
    {
      systemInstruction: PATIENT_TRANSCRIBE_SYSTEM,
      generationConfig: clinicalGenerationConfig(),
    },
    parts,
    120_000,
    getAudioMultimodalModelIds(),
  );
  const text = result.response.text();
  return typeof text === "string" ? text.trim() : "";
}
