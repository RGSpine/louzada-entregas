import { generateEvolution } from "@/app/actions/ai";
import { prisma } from "@/lib/prisma";
import { canAnalyzeImages, canUseVisionInDocumentMerge } from "@/lib/plan-limits";
import {
  buildEnrichedFinancialServiceSuggestion,
} from "@/lib/evolution-commercial-plan";
import {
  downloadDirectUpload,
  inferMimeFromStoragePath,
  removeDirectUploadBestEffort,
} from "@/lib/uploads/direct-upload";

export const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
]);
export const ALLOWED_EXAM_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const MAX_AUDIO_BYTES = 40 * 1024 * 1024; // 40 MB
export const MAX_EXAM_BYTES = 4 * 1024 * 1024; // 4 MB por ficheiro
export const MAX_EXAM_FILES = 5;

export const ASYNC_AUDIO_THRESHOLD_SECONDS = Number(
  process.env.EVOLUTION_ASYNC_AUDIO_THRESHOLD_SECONDS || 180,
);
export const ASYNC_AUDIO_THRESHOLD_BYTES = Number(
  process.env.EVOLUTION_ASYNC_AUDIO_THRESHOLD_BYTES || 4 * 1024 * 1024,
);

export type EvolutionExamPayload = {
  base64: string;
  mimeType: string;
  fileName: string;
};

export type EvolutionAsyncRequestPayload = {
  mergeMode: boolean;
  existingContent?: string;
  /** Integra áudio/anexos na última evolução clínica, sem colar parágrafo. */
  clinicalContinuation?: boolean;
  /** Inline (legacy / sync curto). Mutuamente exclusivo com audioStoragePath no enqueue. */
  audioBase64: string | null;
  /** Referência no bucket direct-uploads — worker descarrega e remove após consumo. */
  audioStoragePath?: string | null;
  audioMimeForModel: string | null;
  /** Duração reportada pelo cliente — orienta pipeline 2 fases no worker. */
  audioDurationSec?: number | null;
  examFiles: EvolutionExamPayload[];
};

export function resolveAudioMime(file: File): string {
  const baseMime = (file.type || "").split(";")[0].trim().toLowerCase();
  let resolvedMime = baseMime;
  if (!resolvedMime || !ALLOWED_AUDIO_MIME.has(resolvedMime)) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".webm")) resolvedMime = "audio/webm";
    else if (name.endsWith(".wav")) resolvedMime = "audio/wav";
    else if (name.endsWith(".mp3")) resolvedMime = "audio/mpeg";
    else if (name.endsWith(".m4a") || name.endsWith(".mp4")) resolvedMime = "audio/mp4";
    else if (name.endsWith(".ogg")) resolvedMime = "audio/ogg";
    else resolvedMime = "audio/webm";
  }
  return resolvedMime;
}

export async function normalizeExamFiles(files: File[]): Promise<EvolutionExamPayload[]> {
  const out: EvolutionExamPayload[] = [];
  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");

    let mimeType = (file.type || "").split(";")[0].trim();
    if (mimeType.toLowerCase() === "image/jpg") {
      mimeType = "image/jpeg";
    }
    if (!mimeType || mimeType === "application/octet-stream") {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".pdf")) mimeType = "application/pdf";
      else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
      else if (lower.endsWith(".png")) mimeType = "image/png";
      else if (lower.endsWith(".webp")) mimeType = "image/webp";
      else mimeType = "image/jpeg";
    }
    out.push({ base64, mimeType, fileName: file.name });
  }
  return out;
}

/** Converte upload direto (mobile/PWA signed URL) em payload para a IA. */
export function examPayloadFromDirectUpload(
  storagePath: string,
  buffer: Buffer,
  mime: string,
): EvolutionExamPayload {
  const fileName = storagePath.slice(storagePath.lastIndexOf("/") + 1) || "exame";
  return {
    base64: buffer.toString("base64"),
    mimeType: mime,
    fileName,
  };
}

export function shouldUseAsyncAudioMode(args: {
  hasAudio: boolean;
  audioDurationSec?: number | null;
  audioBytes?: number;
}): boolean {
  if (!args.hasAudio) return false;
  if (typeof args.audioDurationSec === "number" && args.audioDurationSec >= ASYNC_AUDIO_THRESHOLD_SECONDS) {
    return true;
  }
  if (typeof args.audioBytes === "number" && args.audioBytes >= ASYNC_AUDIO_THRESHOLD_BYTES) {
    return true;
  }
  return false;
}

/**
 * Resolve áudio inline ou via Storage (worker / sync após defer).
 * Remove o objeto do Storage após download bem-sucedido (LGPD).
 */
export async function resolveEvolutionAudioForProcessing(
  dbUserId: string,
  payload: Pick<
    EvolutionAsyncRequestPayload,
    "audioBase64" | "audioStoragePath" | "audioMimeForModel"
  >,
): Promise<{ audioBase64: string | null; audioMimeForModel: string | null }> {
  if (payload.audioBase64) {
    return {
      audioBase64: payload.audioBase64,
      audioMimeForModel: payload.audioMimeForModel,
    };
  }

  const storagePath = payload.audioStoragePath?.trim();
  if (!storagePath) {
    return { audioBase64: null, audioMimeForModel: payload.audioMimeForModel };
  }

  const download = await downloadDirectUpload(dbUserId, storagePath, "audio");
  if (!download.ok) {
    throw new Error(download.error);
  }

  void removeDirectUploadBestEffort(storagePath);
  return {
    audioBase64: download.buffer.toString("base64"),
    audioMimeForModel: payload.audioMimeForModel || download.mime,
  };
}

export async function runEvolutionFromPayload(
  authUser: { id: string; email: string },
  payload: EvolutionAsyncRequestPayload,
  dbUserId?: string,
) {
  let audioBase64 = payload.audioBase64;
  let audioMimeForModel = payload.audioMimeForModel;

  if (!audioBase64 && payload.audioStoragePath) {
    if (!dbUserId) {
      throw new Error("Referência de áudio no Storage requer conta local.");
    }
    const resolved = await resolveEvolutionAudioForProcessing(dbUserId, payload);
    audioBase64 = resolved.audioBase64;
    audioMimeForModel = resolved.audioMimeForModel;
  }

  const { mergeMode, existingContent, examFiles } = payload;
  let planAllowsImageAnalysis = true;

  if (examFiles.length > 0) {
    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email: authUser.email }] },
      select: { plan: true, email: true, isInfluencer: true },
    });
    if (dbUser) {
      const proVision = canAnalyzeImages(dbUser.plan, dbUser.email, dbUser.isInfluencer);
      const mergeVision =
        mergeMode &&
        canUseVisionInDocumentMerge(dbUser.plan, dbUser.email, dbUser.isInfluencer);
      const allowedVision = proVision || mergeVision;
      if (!allowedVision) {
        planAllowsImageAnalysis = false;
        if (!audioBase64) {
          throw new Error(
            mergeMode
              ? "Para anexar ficheiros e a IA interpretar no rascunho do documento é necessário plano Profissional ou superior."
              : "A análise de exames por IA é exclusiva do plano PREMIUM. Faça upgrade para usar esta funcionalidade.",
          );
        }
      }
    }
  }

  const examFilesForAI = planAllowsImageAnalysis && examFiles.length > 0 ? examFiles : undefined;
  const generated = await generateEvolution(
    audioBase64,
    null,
    examFilesForAI,
    mergeMode && existingContent ? existingContent : undefined,
    audioMimeForModel,
    payload.audioDurationSec ?? undefined,
    Boolean(payload.clinicalContinuation && mergeMode && existingContent),
  );

  if ("error" in generated || !dbUserId) {
    return generated;
  }

  const services = await prisma.professionalService.findMany({
    where: { userId: dbUserId, active: true },
    select: { id: true, name: true, defaultPriceCents: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  const generatedText = [
    generated.technicalTranscription,
    generated.transcricao_corrigida,
    generated.queixa,
    generated.conduta,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");

  return {
    ...generated,
    financialServiceSuggestion: buildEnrichedFinancialServiceSuggestion(
      generatedText,
      services,
      generated.commercialCarePlan,
    ),
  };
}
