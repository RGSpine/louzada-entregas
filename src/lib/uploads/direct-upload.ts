import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ALLOWED_AUDIO_MIME,
  ALLOWED_EXAM_MIME,
  MAX_AUDIO_BYTES,
  MAX_EXAM_BYTES,
} from "@/lib/evolution-hybrid";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

/**
 * Upload direto para Supabase Storage via signed URL (mobile/PWA).
 *
 * Bucket PRIVADO (sem leitura pública): os objetos contêm dados clínicos
 * sensíveis (áudio de evolução, exames) e só são lidos no servidor com o
 * admin client, sempre validando que o path pertence ao utilizador.
 */
export const DIRECT_UPLOADS_BUCKET = "direct-uploads";

/** Validade do token de upload assinado (fixa em 2h pelo Supabase Storage). */
export const SIGNED_UPLOAD_EXPIRES_IN_SECONDS = 2 * 60 * 60;

export type DirectUploadKind = "audio" | "exam";

export const SignUploadSchema = z
  .object({
    kind: z.enum(["audio", "exam"]),
    contentType: z.string().min(3).max(120),
    sizeBytes: z.number().int().positive(),
  })
  .refine(
    (input) =>
      input.sizeBytes <= (input.kind === "audio" ? MAX_AUDIO_BYTES : MAX_EXAM_BYTES),
    { message: "Arquivo excede o tamanho máximo permitido.", path: ["sizeBytes"] },
  );

export type SignUploadInput = z.infer<typeof SignUploadSchema>;

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

export function inferMimeFromStoragePath(storagePath: string, kind: DirectUploadKind): string {
  const ext = storagePath.slice(storagePath.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext];
  if (mime) return mime;
  return kind === "audio" ? "audio/webm" : "image/jpeg";
}

/** Paths gerados pelo servidor: `<userId>/<uuid>.<ext>` — nunca aceitar do cliente. */
const STORAGE_PATH_REGEX = /^[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function normalizeContentType(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
}

function limitsForKind(kind: DirectUploadKind) {
  return kind === "audio"
    ? { allowedMime: ALLOWED_AUDIO_MIME, maxBytes: MAX_AUDIO_BYTES }
    : { allowedMime: ALLOWED_EXAM_MIME, maxBytes: MAX_EXAM_BYTES };
}

export type SignUploadSuccess = {
  ok: true;
  data: {
    bucket: string;
    path: string;
    token: string;
    signedUrl: string;
    expiresInSeconds: number;
    maxSizeBytes: number;
    contentType: string;
  };
};

export type DirectUploadFailure = {
  ok: false;
  error: string;
  httpStatus: number;
};

/** Erros do Supabase Storage quando o bucket ainda não existe (mensagens variam por versão). */
export function isStorageResourceMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes("bucket") && lower.includes("not found")) return true;
  if (lower.includes("related resource") && lower.includes("does not exist")) return true;
  if (lower.includes("resource was not found")) return true;
  return false;
}

async function ensureDirectUploadsBucket(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<DirectUploadFailure | null> {
  const { data: buckets, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    logger.error("Direct upload: falha ao listar buckets", {
      feature: "uploads/direct",
      error: listErr.message,
    });
    return { ok: false, error: "Storage indisponível. Tente novamente.", httpStatus: 503 };
  }

  if (buckets?.some((b) => b.name === DIRECT_UPLOADS_BUCKET)) {
    return null;
  }

  const { error: createErr } = await admin.storage.createBucket(DIRECT_UPLOADS_BUCKET, {
    public: false,
    fileSizeLimit: MAX_AUDIO_BYTES,
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    logger.error("Direct upload: falha ao criar bucket privado", {
      feature: "uploads/direct",
      error: createErr.message,
    });
    return { ok: false, error: "Storage indisponível. Tente novamente.", httpStatus: 503 };
  }

  return null;
}

/**
 * Gera signed upload URL com path isolado por utilizador.
 * Cria o bucket privado automaticamente se ainda não existir (idempotente).
 */
export async function createDirectUploadSignedUrl(
  dbUserId: string,
  input: SignUploadInput,
): Promise<SignUploadSuccess | DirectUploadFailure> {
  const contentType = normalizeContentType(input.contentType);
  const { allowedMime, maxBytes } = limitsForKind(input.kind);

  if (!allowedMime.has(contentType)) {
    return {
      ok: false,
      error: `Tipo de arquivo não permitido para ${input.kind}: ${contentType}`,
      httpStatus: 400,
    };
  }
  if (input.sizeBytes > maxBytes) {
    return {
      ok: false,
      error: `Arquivo excede o limite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      httpStatus: 400,
    };
  }

  const ext = EXTENSION_BY_MIME[contentType];
  if (!ext) {
    return {
      ok: false,
      error: `Extensão não mapeada para ${contentType}.`,
      httpStatus: 400,
    };
  }

  const path = `${dbUserId}/${randomUUID()}.${ext}`;
  const admin = createSupabaseAdminClient();

  const bucketReady = await ensureDirectUploadsBucket(admin);
  if (bucketReady) return bucketReady;

  let { data, error } = await admin.storage
    .from(DIRECT_UPLOADS_BUCKET)
    .createSignedUploadUrl(path);

  // Fallback: corrida entre instâncias ou mensagem de bucket ausente não detectada antes.
  if (error && isStorageResourceMissingError(error.message)) {
    const retryReady = await ensureDirectUploadsBucket(admin);
    if (retryReady) return retryReady;
    ({ data, error } = await admin.storage
      .from(DIRECT_UPLOADS_BUCKET)
      .createSignedUploadUrl(path));
  }

  if (error || !data) {
    logger.error("Direct upload: falha ao gerar signed upload URL", {
      feature: "uploads/direct",
      error: error?.message ?? "resposta vazia",
    });
    return { ok: false, error: "Não foi possível gerar a URL de upload.", httpStatus: 502 };
  }

  return {
    ok: true,
    data: {
      bucket: DIRECT_UPLOADS_BUCKET,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      expiresInSeconds: SIGNED_UPLOAD_EXPIRES_IN_SECONDS,
      maxSizeBytes: maxBytes,
      contentType,
    },
  };
}

export type DirectUploadDownload = {
  ok: true;
  buffer: Buffer;
  mime: string;
};

/**
 * Baixa um objeto enviado via signed URL, validando ownership
 * (`path` deve começar por `dbUserId/`), formato do path, MIME e tamanho.
 */
export async function downloadDirectUpload(
  dbUserId: string,
  storagePath: string,
  kind: DirectUploadKind,
): Promise<DirectUploadDownload | DirectUploadFailure> {
  if (
    !STORAGE_PATH_REGEX.test(storagePath) ||
    !storagePath.startsWith(`${dbUserId}/`) ||
    storagePath.includes("..")
  ) {
    logger.warn("Direct upload: path rejeitado (ownership/formato)", {
      feature: "uploads/direct",
      kind,
    });
    return { ok: false, error: "Referência de upload inválida.", httpStatus: 400 };
  }

  const { allowedMime, maxBytes } = limitsForKind(kind);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(DIRECT_UPLOADS_BUCKET).download(storagePath);

  if (error || !data) {
    logger.warn("Direct upload: objeto não encontrado no Storage", {
      feature: "uploads/direct",
      kind,
      error: error?.message ?? "resposta vazia",
    });
    return {
      ok: false,
      error: "Arquivo enviado não encontrado. Refaça o upload.",
      httpStatus: 400,
    };
  }

  if (data.size > maxBytes) {
    return {
      ok: false,
      error: `Arquivo excede o limite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      httpStatus: 400,
    };
  }

  const ext = storagePath.slice(storagePath.lastIndexOf(".") + 1).toLowerCase();
  const mimeFromBlob = normalizeContentType(data.type || "");
  const mime = allowedMime.has(mimeFromBlob) ? mimeFromBlob : MIME_BY_EXTENSION[ext] ?? "";

  if (!allowedMime.has(mime)) {
    return {
      ok: false,
      error: `Tipo de arquivo não permitido para ${kind}.`,
      httpStatus: 400,
    };
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return { ok: true, buffer, mime };
}

/** Remove o objeto após consumo (best-effort) — não persistimos áudio bruto. */
export async function removeDirectUploadBestEffort(storagePath: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.storage.from(DIRECT_UPLOADS_BUCKET).remove([storagePath]);
  } catch (err) {
    logger.warn("Direct upload: falha ao remover objeto consumido", {
      feature: "uploads/direct",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
