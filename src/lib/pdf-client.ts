/** Utilitários de PDF/base64 no browser — Safari iOS falha com data URLs grandes. */

export function isIOSOrSafariPwa(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS || isSafari;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Dispara download/visualização do PDF no browser (incl. iOS PWA).
 * Preferir `pdfUrl` (HTTPS) quando disponível — mais estável no Safari.
 */
export function downloadPdfFromBase64(
  base64: string,
  fileName: string,
  pdfUrl?: string | null,
): void {
  if (pdfUrl && isIOSOrSafariPwa()) {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const bytes = base64ToUint8Array(base64);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    if (isIOSOrSafariPwa()) {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
      return;
    }

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Não foi possível iniciar o download do PDF neste dispositivo.");
  }
}
