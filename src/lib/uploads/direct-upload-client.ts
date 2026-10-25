/** Cliente browser — upload directo Supabase Storage (dashboard web). */

/** Falha de rede/CSP/CORS no PUT para signed URL (xhr.onerror / fetch TypeError). */
export const DIRECT_UPLOAD_NETWORK_ERROR =
  "Upload bloqueado pelo navegador ou rede ao enviar o áudio.";

/** Falha HTTP no Storage após o PUT (token, bucket ou política). */
export function directUploadStorageHttpError(status: number): string {
  return `Falha ao enviar áudio para Storage (HTTP ${status}).`;
}

export function isDirectUploadNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === DIRECT_UPLOAD_NETWORK_ERROR ||
    error.message === "Erro de rede ao enviar áudio."
  );
}

export function isDirectUploadStorageError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Falha ao enviar áudio para Storage")
  );
}

/** Toast secundário conforme a fase da falha (upload vs processamento IA). */
export function describeEvolutionUploadFailure(error: unknown): string | undefined {
  if (isDirectUploadNetworkError(error)) {
    return "Recarregue a página e tente de novo. Se persistir, teste outro navegador ou rede.";
  }
  if (isDirectUploadStorageError(error)) {
    return "O servidor preparou o envio, mas o Storage recusou o arquivo. Grave novamente.";
  }
  return undefined;
}

/** Toast secundário para falhas após upload (IA / fila / timeout). */
export const EVOLUTION_PROCESSING_FAILURE_HINT =
  "Áudio longo pode demorar vários minutos. Se viu limite de espera, use «Recuperar evolução».";

export type DirectUploadSignData = {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresInSeconds: number;
  maxSizeBytes: number;
  contentType: string;
};

export type DirectUploadKind = "audio" | "exam";

export async function signDirectUpload(params: {
  kind: DirectUploadKind;
  contentType: string;
  sizeBytes: number;
  signal?: AbortSignal;
}): Promise<DirectUploadSignData> {
  const res = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    signal: params.signal,
    body: JSON.stringify({
      kind: params.kind,
      contentType: params.contentType,
      sizeBytes: params.sizeBytes,
    }),
  });
  const data: { error?: string } & Partial<DirectUploadSignData> = await res
    .json()
    .catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Não foi possível preparar o upload.");
  }
  if (!data.signedUrl || !data.path || !data.contentType) {
    throw new Error("Resposta de upload incompleta.");
  }
  return data as DirectUploadSignData;
}

/**
 * PUT do blob para signed URL. Usa XHR para expor progresso quando pedido.
 */
export function putBlobToSignedUploadUrl(
  blob: Blob,
  signed: DirectUploadSignData,
  options?: { signal?: AbortSignal; onProgress?: (pct: number) => void },
): Promise<void> {
  const { signal, onProgress } = options ?? {};

  if (!onProgress) {
    return fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": signed.contentType },
      body: blob,
      signal,
    }).then((res) => {
      if (!res.ok) {
        throw new Error(directUploadStorageHttpError(res.status));
      }
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl);
    xhr.setRequestHeader("Content-Type", signed.contentType);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(directUploadStorageHttpError(xhr.status)));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(DIRECT_UPLOAD_NETWORK_ERROR));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(blob);
  });
}

/** Envia áudio gravado ao Storage e devolve metadados para POST /api/evolution. */
export async function uploadEvolutionAudioBlob(
  blob: Blob,
  options?: {
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
  },
): Promise<{ storagePath: string; contentType: string; sizeBytes: number }> {
  const contentType = (blob.type || "audio/webm").split(";")[0]!.trim() || "audio/webm";
  const signed = await signDirectUpload({
    kind: "audio",
    contentType,
    sizeBytes: blob.size,
    signal: options?.signal,
  });
  await putBlobToSignedUploadUrl(blob, signed, {
    signal: options?.signal,
    onProgress: options?.onProgress,
  });
  return {
    storagePath: signed.path,
    contentType: signed.contentType,
    sizeBytes: blob.size,
  };
}
