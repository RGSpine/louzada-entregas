import { isAppleMobileSafari } from "@/lib/media-recorder-safe";

/** MIME real do MediaRecorder — evita WebM com rótulo audio/wav no Gemini. */
export function getSupportedRecorderMimeOptions(): { mimeType: string } | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = isAppleMobileSafari()
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    : [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
  for (const mimeType of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return { mimeType };
      }
    } catch {
      /* ignorar */
    }
  }
  return undefined;
}

export function fileExtensionForAudioBlob(mimeBase: string): string {
  const m = mimeBase.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m === "audio/mp3") return "mp3";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}
