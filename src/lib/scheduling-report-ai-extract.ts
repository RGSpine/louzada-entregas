import type { Part } from "@google/generative-ai";
import { z } from "zod";
import { generateContentSafeWithModelFallback } from "@/lib/gemini";
import { formatAiProviderErrorForUser } from "@/lib/ai-provider-user-message";
import {
  type AgendaReportKind,
  classifyReportByKeywords,
} from "@/lib/agenda-reports";

export const agendaReportModelSchema = z.object({
  reportKind: z.enum([
    "tomorrow_count",
    "tomorrow_names",
    "last_week_attended",
    "last_month_attended",
    "unknown",
  ]),
  transcript: z.string().max(2000).nullable().optional(),
  confidenceOverall: z.number().min(0).max(1).default(0),
});

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const PROMPT = `
Classifica a pergunta do profissional sobre a AGENDA (relatório, não agendamento).

Tipos:
- tomorrow_count: quantos pacientes/consultas amanhã
- tomorrow_names: nomes dos pacientes amanhã
- last_week_attended: quantos atendi / consultas na última semana
- last_month_attended: quantos atendi no último mês / 30 dias
- unknown: não é relatório de agenda

JSON EXACTO:
{ "reportKind": "...", "transcript": string | null, "confidenceOverall": number }
`.trim();

export async function extractAgendaReportKindFromAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<
  | { ok: true; reportKind: AgendaReportKind; transcript?: string | null }
  | { ok: false; error: string }
> {
  const parts: Part[] = [
    { text: PROMPT },
    {
      inlineData: {
        mimeType: params.mimeType || "audio/webm",
        data: params.audioBase64,
      },
    },
    { text: "(áudio acima — classifica o tipo de relatório)" },
  ];

  try {
    const { result } = await generateContentSafeWithModelFallback(
      {
        systemInstruction:
          "Respondes só JSON. Perguntas sobre agenda clínica em português do Brasil.",
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      },
      parts,
      90_000,
    );
    const text = result.response.text();
    if (!text?.trim()) {
      return { ok: false, error: "Áudio não compreendido." };
    }
    let json: unknown;
    try {
      json = JSON.parse(stripJsonFences(text));
    } catch {
      return { ok: false, error: "Resposta da IA inválida." };
    }
    const parsed = agendaReportModelSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Classificação inválida." };
    }
    const transcript = parsed.data.transcript ?? "";
    let kind = parsed.data.reportKind;
    if (kind === "unknown" && transcript) {
      const kw = classifyReportByKeywords(transcript);
      if (kw) kind = kw;
    }
    return {
      ok: true,
      reportKind: kind,
      transcript: parsed.data.transcript,
    };
  } catch (e) {
    return { ok: false, error: formatAiProviderErrorForUser(e) };
  }
}

export function resolveReportKindFromText(text: string): AgendaReportKind {
  return classifyReportByKeywords(text) ?? "unknown";
}
