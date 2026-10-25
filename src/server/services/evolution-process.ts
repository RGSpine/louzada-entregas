import { z } from "zod";
import { reviseEvolutionContent } from "@/app/actions/ai";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  ALLOWED_AUDIO_MIME,
  ALLOWED_EXAM_MIME,
  MAX_AUDIO_BYTES,
  MAX_EXAM_BYTES,
  MAX_EXAM_FILES,
  examPayloadFromDirectUpload,
  normalizeExamFiles,
  resolveAudioMime,
  runEvolutionFromPayload,
  shouldUseAsyncAudioMode,
} from "@/lib/evolution-hybrid";
import {
  scheduleEvolutionJobProcessing,
} from "@/lib/evolution-job-worker";
import {
  buildEnrichedFinancialServiceSuggestion,
} from "@/lib/evolution-commercial-plan";
import {
  downloadDirectUpload,
  inferMimeFromStoragePath,
  removeDirectUploadBestEffort,
} from "@/lib/uploads/direct-upload";

export const EvolutionFormSchema = z.object({
  mergeMode: z.boolean().default(false),
  revisionMode: z.boolean().default(false),
  clinicalContinuation: z.boolean().default(false),
  existingContent: z.string().max(200_000).optional().nullable(),
  revisionContent: z.string().max(200_000).optional().nullable(),
  audioDurationSec: z.number().int().min(0).optional().nullable(),
  /** Tamanho em bytes reportado pelo cliente após upload directo ao Storage. */
  audioSizeBytes: z.number().int().positive().optional().nullable(),
  /** Path no bucket de uploads diretos (ver /api/uploads/sign) — alternativa ao campo `audio`. */
  audioStoragePath: z.string().max(300).optional().nullable(),
});

export type EvolutionAuthUser = {
  id: string;
  email: string;
};

export type EvolutionProcessRevision = {
  kind: "revision";
  body: Record<string, unknown>;
};

export type EvolutionProcessSync = {
  kind: "sync";
  body: Record<string, unknown>;
};

export type EvolutionProcessAsync = {
  kind: "async";
  jobId: string;
  status: string;
  createdAt: Date;
};

export type EvolutionProcessError = {
  kind: "error";
  message: string;
  httpStatus: number;
};

export type EvolutionProcessResult =
  | EvolutionProcessRevision
  | EvolutionProcessSync
  | EvolutionProcessAsync
  | EvolutionProcessError;

function parseExamStoragePaths(formData: FormData): string[] {
  const paths: string[] = [];
  const repeated = formData.getAll("examStoragePath");
  for (const item of repeated) {
    if (typeof item === "string" && item.trim()) paths.push(item.trim());
  }
  const rawJson = formData.get("examStoragePaths");
  if (typeof rawJson === "string" && rawJson.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) paths.push(item.trim());
        }
      }
    } catch {
      // ignore malformed JSON — paths individuais ainda podem ser válidos
    }
  }
  return [...new Set(paths)];
}

async function loadExamFilesFromStorage(
  dbUserId: string,
  storagePaths: string[],
): Promise<
  | { ok: true; files: Awaited<ReturnType<typeof normalizeExamFiles>> }
  | { ok: false; message: string; httpStatus: number }
> {
  const files = [];
  for (const storagePath of storagePaths) {
    const download = await downloadDirectUpload(dbUserId, storagePath, "exam");
    if (!download.ok) {
      return { ok: false, message: download.error, httpStatus: download.httpStatus };
    }
    files.push(examPayloadFromDirectUpload(storagePath, download.buffer, download.mime));
    void removeDirectUploadBestEffort(storagePath);
  }
  return { ok: true, files };
}

function parseEvolutionFormData(formData: FormData) {
  return EvolutionFormSchema.safeParse({
    mergeMode: formData.get("mergeMode") === "true",
    revisionMode: formData.get("revisionMode") === "true",
    clinicalContinuation: formData.get("clinicalContinuation") === "true",
    existingContent: formData.get("existingContent") as string | null,
    revisionContent: formData.get("revisionContent") as string | null,
    audioDurationSec:
      typeof formData.get("audioDurationSec") === "string"
        ? Number(formData.get("audioDurationSec"))
        : undefined,
    audioSizeBytes:
      typeof formData.get("audioSizeBytes") === "string"
        ? Number(formData.get("audioSizeBytes"))
        : undefined,
    audioStoragePath:
      typeof formData.get("audioStoragePath") === "string"
        ? (formData.get("audioStoragePath") as string)
        : undefined,
  });
}

/**
 * Pipeline compartilhado de geração de evolução (web `/api/evolution` e `/api/v1/evolution`).
 * Requer auth já validada pelo caller.
 */
export async function processEvolutionFormData(
  authUser: EvolutionAuthUser,
  dbUserId: string | null,
  formData: FormData,
): Promise<EvolutionProcessResult> {
  const parsedForm = parseEvolutionFormData(formData);
  if (!parsedForm.success) {
    return {
      kind: "error",
      message: parsedForm.error.issues.map((i) => i.message).join("; "),
      httpStatus: 400,
    };
  }

  const {
    mergeMode,
    revisionMode,
    clinicalContinuation,
    existingContent,
    revisionContent,
    audioDurationSec,
    audioSizeBytes,
    audioStoragePath,
  } = parsedForm.data;

  if (revisionMode && revisionContent) {
    const result = await reviseEvolutionContent(revisionContent);
    if ("error" in result) {
      return { kind: "error", message: result.error, httpStatus: 500 };
    }
    const services = dbUserId
      ? await prisma.professionalService.findMany({
          where: { userId: dbUserId, active: true },
          select: { id: true, name: true, defaultPriceCents: true },
          take: 200,
        })
      : [];
    return {
      kind: "revision",
      body: {
        ...result,
        financialServiceSuggestion: buildEnrichedFinancialServiceSuggestion(
          [
            result.technicalTranscription,
            result.transcricao_corrigida,
            result.queixa,
            result.conduta,
          ]
            .filter((value): value is string => typeof value === "string")
            .join("\n"),
          services,
          result.commercialCarePlan,
        ),
      } as unknown as Record<string, unknown>,
    };
  }

  const audioFile = formData.get("audio") as File | null;
  let audioBase64: string | null = null;
  let audioMimeForModel: string | null = null;
  let audioBytes: number | undefined;
  /** Áudio no Storage — download adiado para o worker quando assíncrono. */
  let deferredAudioStoragePath: string | null = null;

  if (audioFile && audioFile.size > 0) {
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return {
        kind: "error",
        message: "Arquivo de áudio excede o limite de 40 MB.",
        httpStatus: 400,
      };
    }
    const resolvedMime = resolveAudioMime(audioFile);
    if (!ALLOWED_AUDIO_MIME.has(resolvedMime)) {
      return {
        kind: "error",
        message: `Tipo de áudio não permitido: ${audioFile.type || resolvedMime}`,
        httpStatus: 400,
      };
    }
    audioMimeForModel = resolvedMime;
    const audioArrayBuffer = await audioFile.arrayBuffer();
    audioBase64 = Buffer.from(audioArrayBuffer).toString("base64");
    audioBytes = audioFile.size;
  }

  if (!audioBase64 && audioStoragePath) {
    if (!dbUserId) {
      return {
        kind: "error",
        message: "Conta sem registro local — upload direto indisponível.",
        httpStatus: 400,
      };
    }
    audioBytes =
      typeof audioSizeBytes === "number" && audioSizeBytes > 0
        ? audioSizeBytes
        : undefined;
    audioMimeForModel =
      audioMimeForModel || inferMimeFromStoragePath(audioStoragePath, "audio");

    const willDeferToWorker =
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: audioDurationSec ?? null,
        audioBytes,
      }) && !!dbUserId;

    if (willDeferToWorker) {
      deferredAudioStoragePath = audioStoragePath;
    } else {
      const download = await downloadDirectUpload(dbUserId, audioStoragePath, "audio");
      if (!download.ok) {
        return { kind: "error", message: download.error, httpStatus: download.httpStatus };
      }
      audioBase64 = download.buffer.toString("base64");
      audioMimeForModel = download.mime;
      audioBytes = download.buffer.byteLength;
      void removeDirectUploadBestEffort(audioStoragePath);
    }
  }

  const examStoragePaths = parseExamStoragePaths(formData);
  const examFilesData = formData.getAll("examFiles") as File[];
  const totalExamCount = examFilesData.length + examStoragePaths.length;
  if (totalExamCount > MAX_EXAM_FILES) {
    return {
      kind: "error",
      message: `Máximo de ${MAX_EXAM_FILES} arquivos de exame por requisição.`,
      httpStatus: 400,
    };
  }

  for (const f of examFilesData) {
    if (f.size > MAX_EXAM_BYTES) {
      return {
        kind: "error",
        message: `Arquivo "${f.name}" excede o limite de 4 MB.`,
        httpStatus: 400,
      };
    }
    const rawMime = (f.type || "").split(";")[0].trim().toLowerCase();
    const normalizedMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
    if (normalizedMime && !ALLOWED_EXAM_MIME.has(normalizedMime)) {
      return {
        kind: "error",
        message: `Tipo de arquivo não permitido: ${f.type || "desconhecido"}`,
        httpStatus: 400,
      };
    }
  }

  if (!audioBase64 && !deferredAudioStoragePath && totalExamCount === 0) {
    return {
      kind: "error",
      message: "Forneça um áudio ou pelo menos um arquivo de exame",
      httpStatus: 400,
    };
  }

  let processedExamFiles = await normalizeExamFiles(examFilesData);
  if (examStoragePaths.length > 0) {
    if (!dbUserId) {
      return {
        kind: "error",
        message: "Conta sem registro local — upload direto de exames indisponível.",
        httpStatus: 400,
      };
    }
    const fromStorage = await loadExamFilesFromStorage(dbUserId, examStoragePaths);
    if (!fromStorage.ok) {
      return { kind: "error", message: fromStorage.message, httpStatus: fromStorage.httpStatus };
    }
    processedExamFiles = [...processedExamFiles, ...fromStorage.files];
  }

  const hasAudio = !!audioBase64 || !!deferredAudioStoragePath;
  const shouldUseAsync =
    !revisionMode &&
    shouldUseAsyncAudioMode({
      hasAudio,
      audioDurationSec: audioDurationSec ?? null,
      audioBytes,
    });

  if (shouldUseAsync && dbUserId) {
    const job = await prisma.evolutionProcessingJob.create({
      data: {
        userId: dbUserId,
        status: "QUEUED",
        requestData: {
          mergeMode,
          clinicalContinuation: Boolean(
            clinicalContinuation && mergeMode && existingContent,
          ),
          existingContent: mergeMode && existingContent ? existingContent : undefined,
          audioBase64: deferredAudioStoragePath ? null : audioBase64,
          audioStoragePath: deferredAudioStoragePath ?? undefined,
          audioMimeForModel,
          audioDurationSec: audioDurationSec ?? undefined,
          examFiles: processedExamFiles,
        },
      },
      select: { id: true, status: true, createdAt: true },
    });

    scheduleEvolutionJobProcessing(job.id);

    if (!process.env.CRON_SECRET?.trim()) {
      logger.warn(
        "Evolution service: CRON_SECRET ausente — configure para processar jobs assíncronos.",
        { feature: "evolution-process" },
      );
    }

    return {
      kind: "async",
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  if (shouldUseAsync && !dbUserId) {
    logger.warn("Evolution service: usuário sem registro local, fallback síncrono", {
      feature: "evolution-process",
      email: authUser.email.slice(0, 3) + "***",
    });
  }

  const result = await runEvolutionFromPayload(
    authUser,
    {
      mergeMode,
      clinicalContinuation: Boolean(clinicalContinuation && mergeMode && existingContent),
      existingContent: mergeMode && existingContent ? existingContent : undefined,
      audioBase64,
      audioStoragePath: null,
      audioMimeForModel,
      audioDurationSec: audioDurationSec ?? undefined,
      examFiles: processedExamFiles,
    },
    dbUserId ?? undefined,
  );

  if ("error" in result) {
    return {
      kind: "error",
      message: result.error,
      httpStatus: result.error.includes("plano") ? 403 : 500,
    };
  }

  return { kind: "sync", body: result as unknown as Record<string, unknown> };
}
