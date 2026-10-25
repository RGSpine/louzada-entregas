/**
 * Heurísticas para áudio longo na Nova Evolução (>4 min / PRO).
 * Centraliza thresholds usados pelo modo assíncrono e pipeline 2 fases.
 */

/** Segundos — a partir daqui preferimos transcrever e só depois estruturar JSON. */
export const LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS = Number(
  process.env.EVOLUTION_LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS || 240,
);

/** Bytes (~4 MB) — rede de segurança quando `audioDurationSec` não chega do cliente. */
export const LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES = Number(
  process.env.EVOLUTION_LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES || 4 * 1024 * 1024,
);

export function approxBytesFromBase64(base64: string | null | undefined): number {
  if (!base64) return 0;
  return Math.floor((base64.length * 3) / 4);
}

export function isLongEvolutionAudio(args: {
  approxAudioBytes?: number;
  audioDurationSec?: number | null;
}): boolean {
  if (
    typeof args.audioDurationSec === "number" &&
    args.audioDurationSec >= LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS
  ) {
    return true;
  }
  if (
    typeof args.approxAudioBytes === "number" &&
    args.approxAudioBytes >= LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES
  ) {
    return true;
  }
  return false;
}

/** Timeout Gemini proporcional ao tamanho do áudio (sempre abaixo de maxDuration 300s da rota). */
export function evolutionMultimodalTimeoutMs(approxAudioBytes: number): number {
  if (approxAudioBytes >= 12 * 1024 * 1024) return 285_000;
  if (approxAudioBytes >= 6 * 1024 * 1024) return 270_000;
  if (approxAudioBytes >= LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES) return 255_000;
  return 210_000;
}

/** Fase 1 (só transcrição) — não cortar artificialmente em 150s para áudios longos. */
export function evolutionTranscribePhaseTimeoutMs(multimodalTimeoutMs: number): number {
  return Math.min(multimodalTimeoutMs, 280_000);
}

export function hasUsableEvolutionTranscription(data: {
  technicalTranscription?: string;
  transcricao_corrigida?: string;
}): boolean {
  const text = (data.technicalTranscription || data.transcricao_corrigida || "").trim();
  return text.length >= 40;
}
