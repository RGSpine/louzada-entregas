import { shouldUseAsyncAudioMode, ASYNC_AUDIO_THRESHOLD_SECONDS } from "@/lib/evolution-hybrid";
import {
  approxBytesFromBase64,
  evolutionMultimodalTimeoutMs,
  evolutionTranscribePhaseTimeoutMs,
  hasUsableEvolutionTranscription,
  isLongEvolutionAudio,
  LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES,
  LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS,
} from "@/lib/evolution-long-audio";
import { shouldTryEvolutionTwoPhaseFallback } from "@/lib/evolution-llm-fallback";
import type { DailySuiteResult } from "@/lib/evolution-audio-daily/types";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Categorias #1 e #4 — sensores inline (sem spawn de test runner). */
export function runUnitThresholdChecks(): DailySuiteResult[] {
  const results: DailySuiteResult[] = [];

  try {
    assert(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 300 }) === true,
      "5 min deve ser async",
    );
    assert(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 240 }) === true,
      "4 min deve ser async",
    );
    assert(
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: 120,
        audioBytes: 2 * 1024 * 1024,
      }) === false,
      "2 min síncrono",
    );
    const bytes = LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES + 512 * 1024;
    assert(
      shouldUseAsyncAudioMode({ hasAudio: true, audioBytes: bytes }) === true,
      "bytes elevados async",
    );
    assert(isLongEvolutionAudio({ audioDurationSec: 310 }) === true, "310s long");
    assert(
      isLongEvolutionAudio({
        approxAudioBytes: LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES + 1000,
      }) === true,
      "bytes long",
    );
    assert(evolutionMultimodalTimeoutMs(5 * 1024 * 1024) === 255_000, "timeout 5MB");
    assert(evolutionTranscribePhaseTimeoutMs(255_000) === 255_000, "fase1 255s");
    assert(evolutionTranscribePhaseTimeoutMs(285_000) === 280_000, "fase1 cap 280s");
    assert(hasUsableEvolutionTranscription({}) === false, "vazio rejeitado");
    assert(
      hasUsableEvolutionTranscription({
        technicalTranscription:
          "Paciente relata dor lombar há três semanas, piora ao sentar por longos períodos.",
      }) === true,
      "texto clínico aceite",
    );
    const approx = approxBytesFromBase64("A".repeat(4000));
    assert(approx >= 2900 && approx <= 3100, "approxBytesFromBase64");
    assert(
      shouldTryEvolutionTwoPhaseFallback(new Error("Timeout após 210000ms")) === true,
      "fallback timeout",
    );
    assert(LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS === 240, "limiar 240s");
    results.push({
      id: 1,
      name: "Integração Storage → async (unit inline)",
      ok: true,
      skipped: false,
      detail: "11 asserções OK",
    });
  } catch (e) {
    results.push({
      id: 1,
      name: "Integração Storage → async (unit inline)",
      ok: false,
      skipped: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    assert(
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: ASYNC_AUDIO_THRESHOLD_SECONDS - 1,
      }) === false,
      "2:59 síncrono",
    );
    assert(
      shouldUseAsyncAudioMode({
        hasAudio: true,
        audioDurationSec: ASYNC_AUDIO_THRESHOLD_SECONDS + 1,
      }) === true,
      "3:01 async",
    );
    assert(isLongEvolutionAudio({ audioDurationSec: 240 }) === true, "4 min 2 fases");
    assert(shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 360 }) === true, "6 min async");
    assert(
      hasUsableEvolutionTranscription({ technicalTranscription: "ok curto" }) === false,
      "curto rejeitado",
    );
    results.push({
      id: 4,
      name: "Edge cases duração/rede (unit inline)",
      ok: true,
      skipped: false,
      detail: "5 asserções OK",
    });
  } catch (e) {
    results.push({
      id: 4,
      name: "Edge cases duração/rede (unit inline)",
      ok: false,
      skipped: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return results;
}
