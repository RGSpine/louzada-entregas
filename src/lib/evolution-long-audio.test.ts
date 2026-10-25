import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldUseAsyncAudioMode } from "@/lib/evolution-hybrid";
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

describe("evolution-long-audio — sensores PRO ~5 min", () => {
  it("5 min (300 s) dispara modo assíncrono por duração", () => {
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 300 }),
      true,
    );
  });

  it("4 min (240 s) dispara modo assíncrono por duração", () => {
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 240 }),
      true,
    );
  });

  it("2 min (120 s) permanece síncrono sem bytes elevados", () => {
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 120, audioBytes: 2 * 1024 * 1024 }),
      false,
    );
  });

  it("sem audioDurationSec, ~5 MB dispara async pelo limiar de bytes (4 MB default)", () => {
    const bytes = LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES + 512 * 1024;
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioBytes: bytes }),
      true,
    );
  });

  it("isLongEvolutionAudio detecta 5 min e ~4.5 MB", () => {
    assert.equal(isLongEvolutionAudio({ audioDurationSec: 310 }), true);
    assert.equal(
      isLongEvolutionAudio({ approxAudioBytes: LONG_AUDIO_TWO_PHASE_THRESHOLD_BYTES + 1000 }),
      true,
    );
    assert.equal(isLongEvolutionAudio({ audioDurationSec: 120 }), false);
  });

  it("timeout multimodal escala para áudio ~5 MB (255 s)", () => {
    const fiveMb = 5 * 1024 * 1024;
    assert.equal(evolutionMultimodalTimeoutMs(fiveMb), 255_000);
  });

  it("fase 1 de transcrição não fica presa em 150 s", () => {
    assert.equal(evolutionTranscribePhaseTimeoutMs(255_000), 255_000);
    assert.equal(evolutionTranscribePhaseTimeoutMs(285_000), 280_000);
  });

  it("hasUsableEvolutionTranscription rejeita vazio e aceita texto clínico", () => {
    assert.equal(hasUsableEvolutionTranscription({}), false);
    assert.equal(
      hasUsableEvolutionTranscription({ technicalTranscription: "ok" }),
      false,
    );
    assert.equal(
      hasUsableEvolutionTranscription({
        technicalTranscription:
          "Paciente relata dor lombar há três semanas, piora ao sentar por longos períodos.",
      }),
      true,
    );
  });

  it("approxBytesFromBase64 aproxima tamanho do ficheiro", () => {
    const b64 = "A".repeat(4000);
    const approx = approxBytesFromBase64(b64);
    assert.ok(approx >= 2900 && approx <= 3100);
  });

  it("fallback 2 fases também dispara em timeout (não só 503)", () => {
    assert.equal(
      shouldTryEvolutionTwoPhaseFallback(new Error("Timeout após 210000ms")),
      true,
    );
    assert.equal(
      shouldTryEvolutionTwoPhaseFallback(new Error("503 Service Unavailable")),
      true,
    );
    assert.equal(
      shouldTryEvolutionTwoPhaseFallback(new Error("invalid JSON from model")),
      false,
    );
  });

  it("limiar 2 fases default é 240 s (4 min)", () => {
    assert.equal(LONG_AUDIO_TWO_PHASE_THRESHOLD_SECONDS, 240);
  });
});
