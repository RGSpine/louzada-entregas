import { z } from "zod";
import type { HealthTaskType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { clinicalGenerationConfig } from "@/lib/clinical-harness";
import { transcribePatientMedia } from "@/lib/b2c/patient-transcribe";
import {
  groundPatientIntake,
  PATIENT_INTAKE_EXTRACTION_POLICY,
} from "@/lib/b2c/patient-audio-grounding";
import { parsePanoramaReview } from "@/lib/b2c/consultation-structured";
import { applyPanoramaRejection } from "@/lib/b2c/patient-clinical-review";
import {
  generateContentSafe,
  getGeminiFastModel,
  GEMINI_FAST_MODEL,
  isGeminiConfigured,
} from "@/lib/gemini";
import { logGeminiUsage } from "@/lib/ai-usage";
import { logger } from "@/lib/logger";
import {
  consultationStructuredSchema,
  sanitizeConsultationStructured,
} from "@/lib/b2c/consultation-structured";
import { runPatientHealthManager } from "@/lib/b2c/health-manager";

const intakeResultSchema = z.object({
  translatedExplanation: z.string().min(1).max(12_000),
  professionalName: z.string().max(200).nullable().optional(),
  specialty: z.string().max(200).nullable().optional(),
  recommendations: z.array(z.string().max(400)).max(12).default([]),
  attentionPoints: z.array(z.string().max(400)).max(12).default([]),
  orientations: z.array(z.string().max(400)).max(12).default([]),
  panoramaSnippet: z.string().max(2000).nullable().optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        type: z.enum([
          "MEDICATION",
          "EXAM",
          "RETURN_VISIT",
          "WATER",
          "OTHER",
        ]),
        scheduledTime: z.string().datetime().nullable().optional(),
      }),
    )
    .max(12)
    .default([]),
  references: z
    .array(
      z.object({
        title: z.string().max(200),
        url: z.string().max(500).optional(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
});

export type HealthIntakeSource =
  | "consultation_audio"
  | "exam_ocr"
  | "consultation_bundle";

export type ProcessHealthIntakeInput = {
  healthProfileId: string;
  sourceType: HealthIntakeSource;
  audio?: { mimeType: string; base64: string } | null;
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
};

export type ProcessHealthIntakeResult =
  | {
      success: true;
      summaryId: string;
      translatedExplanation: string;
      tasksCreated: number;
      groundingWarnings: string[];
    }
  | { success: false; error: string };

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function requestIntakeJson(
  model: ReturnType<typeof getGeminiFastModel>,
  prompt: string,
  sourceType: HealthIntakeSource,
) {
  const result = await generateContentSafe(model, prompt, 90_000, 1);
  logGeminiUsage(result, {
    service: "b2c_intake",
    model: GEMINI_FAST_MODEL,
    surface: "patient",
    meta: { sourceType },
  });
  try {
    const parsed = intakeResultSchema.safeParse(
      JSON.parse(stripJsonFences(result.response.text())),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toTaskType(value: string): HealthTaskType {
  switch (value) {
    case "MEDICATION":
    case "EXAM":
    case "RETURN_VISIT":
    case "WATER":
    case "OTHER":
      return value;
    default:
      return "OTHER";
  }
}

/**
 * Transcreve/OCR → LLM estrutura consulta → ClinicalSummary + HealthTasks + panorama.
 */
export async function processHealthIntake(
  input: ProcessHealthIntakeInput,
): Promise<ProcessHealthIntakeResult> {
  if (!isGeminiConfigured()) {
    return { success: false, error: "IA temporariamente indisponível." };
  }

  const hasAudio = Boolean(input.audio?.base64);
  const hasImages = (input.images ?? []).some((image) => image.base64);
  if (!hasAudio && !hasImages) {
    return { success: false, error: "Envie um áudio ou uma imagem/PDF de exame." };
  }

  let originalText = "";
  try {
    originalText = await transcribePatientMedia({
      audio: input.audio,
      images: input.images,
    });
  } catch (error) {
    logger.error("Falha na transcrição/OCR B2C", {
      feature: "b2c-health-intake",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Não foi possível ler o áudio ou o exame." };
  }

  originalText = sanitizeText(originalText).slice(0, 40_000);
  if (originalText.length < 20) {
    return {
      success: false,
      error: "Não encontramos conteúdo suficiente no arquivo. Tente novamente.",
    };
  }

  const sourceLabel =
    input.sourceType === "exam_ocr"
      ? "exame / laudo (OCR)"
      : input.sourceType === "consultation_bundle"
        ? "gravação da consulta + anexos (exames/laudos)"
        : "gravação da consulta (fala do profissional)";

  const systemInstruction = `Você ajuda um paciente leigo a entender informações de saúde em português do Brasil.
Este texto fará parte da MEMÓRIA permanente do Mapa de Saúde do paciente (assessor contínuo).

${PATIENT_INTAKE_EXTRACTION_POLICY}

Receberá o texto bruto de: ${sourceLabel}.
1) Explique em linguagem simples, sem alarmismo, só o que está na fonte.
2) Extraia nome do profissional e especialidade SOMENTE se estiverem claros no texto (senão null).
3) Liste recomendações, pontos de atenção e orientações práticas daquela consulta/exame.
4) panoramaSnippet: 1–3 frases sobre o estado geral com base NESTE material (sem inventar).
5) Extraia tarefas (medicação, exame, retorno, água, outros) só se foram ditas ou escritas.
6) Não dê diagnóstico definitivo; oriente a confirmar com o profissional.

Responda APENAS JSON válido:
{
  "translatedExplanation": "string",
  "professionalName": "string|null",
  "specialty": "string|null",
  "recommendations": ["string"],
  "attentionPoints": ["string"],
  "orientations": ["string"],
  "panoramaSnippet": "string|null",
  "tasks": [{"title":"string","type":"MEDICATION|EXAM|RETURN_VISIT|WATER|OTHER","scheduledTime":null}],
  "references": [{"title":"string","url":"string opcional"}]
}`;

  try {
    const model = getGeminiFastModel({
      systemInstruction,
      generationConfig: clinicalGenerationConfig(),
    });
    const prompt = `Texto bruto:\n${originalText}`;
    let parsed = await requestIntakeJson(model, prompt, input.sourceType);
    if (!parsed) {
      parsed = await requestIntakeJson(model, prompt, input.sourceType);
    }
    if (!parsed) {
      return {
        success: false,
        error: "A IA não retornou um resumo válido. Tente de novo.",
      };
    }

    const grounded = groundPatientIntake(
      {
        translatedExplanation: parsed.translatedExplanation,
        professionalName: parsed.professionalName?.trim() || null,
        specialty: parsed.specialty?.trim() || null,
        recommendations: parsed.recommendations,
        attentionPoints: parsed.attentionPoints,
        orientations: parsed.orientations,
        panoramaSnippet: parsed.panoramaSnippet?.trim() || null,
        tasks: parsed.tasks,
      },
      originalText,
    );
    parsed = { ...parsed, ...grounded.draft };

    const explanation = sanitizeText(parsed.translatedExplanation).slice(0, 12_000);
    if (!explanation) {
      return {
        success: false,
        error: "A IA não retornou um resumo válido. Tente de novo.",
      };
    }
    const references = (parsed.references ?? []).map((ref) => ({
      title: sanitizeText(ref.title).slice(0, 200),
      ...(ref.url ? { url: sanitizeText(ref.url).slice(0, 500) } : {}),
    }));
    const previousSummary = await prisma.clinicalSummary.findFirst({
      where: { healthProfileId: input.healthProfileId },
      orderBy: { createdAt: "desc" },
      select: { structured: true },
    });
    const carriedPanoramaReview = parsePanoramaReview(previousSummary?.structured);
    const structured = sanitizeConsultationStructured({
      professionalName: parsed.professionalName,
      specialty: parsed.specialty,
      recommendations: parsed.recommendations,
      attentionPoints: parsed.attentionPoints,
      orientations: parsed.orientations,
      panoramaSnippet: parsed.panoramaSnippet,
      ...(carriedPanoramaReview.rejected.length || carriedPanoramaReview.userEditedAt
        ? { panoramaReview: carriedPanoramaReview }
        : {}),
    });
    // validação tipada (evita lixo no JSON)
    consultationStructuredSchema.safeParse(structured);

    const summary = await prisma.clinicalSummary.create({
      data: {
        healthProfileId: input.healthProfileId,
        originalText,
        translatedExplanation: explanation,
        references,
        structured,
        sourceType: input.sourceType,
        healthTasks: {
          create: parsed.tasks.map((task) => ({
            healthProfileId: input.healthProfileId,
            title: sanitizeText(task.title).slice(0, 300),
            type: toTaskType(task.type),
            scheduledTime: task.scheduledTime
              ? new Date(task.scheduledTime)
              : null,
          })),
        },
      },
      select: {
        id: true,
        _count: { select: { healthTasks: true } },
      },
    });

    const panoramaSnippet = structured.panoramaSnippet
      ? applyPanoramaRejection(
          structured.panoramaSnippet,
          carriedPanoramaReview.rejected,
        )
      : "";
    if (panoramaSnippet) {
      const previous = await prisma.healthProfile.findUnique({
        where: { id: input.healthProfileId },
        select: { healthPanorama: true },
      });
      const merged = [
        panoramaSnippet,
        previous?.healthPanorama?.trim() || null,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 6_000);
      await prisma.healthProfile.update({
        where: { id: input.healthProfileId },
        data: { healthPanorama: merged },
      });
    }

    // Flash + DeepSeek reconectam a memória completa e atualizam o panorama.
    void runPatientHealthManager({
      healthProfileId: input.healthProfileId,
      userQuestion: `Novo registro (${input.sourceType}): ${explanation.slice(0, 800)}`,
      persistPanorama: true,
      // Pós-intake: quer match na vitrine mesmo com userQuestion preenchido.
      includeCatalog: true,
    }).catch((error) => {
      logger.warn("health-manager pós-intake falhou", {
        feature: "b2c-health-intake",
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return {
      success: true,
      summaryId: summary.id,
      translatedExplanation: explanation,
      tasksCreated: summary._count.healthTasks,
      groundingWarnings: grounded.warnings,
    };
  } catch (error) {
    logger.error("Falha no processamento B2C health intake", {
      feature: "b2c-health-intake",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: "Não foi possível interpretar o conteúdo agora.",
    };
  }
}
