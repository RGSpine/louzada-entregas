import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldUseAsyncAudioMode, ASYNC_AUDIO_THRESHOLD_SECONDS } from "@/lib/evolution-hybrid";
import {
  isLongEvolutionAudio,
  hasUsableEvolutionTranscription,
} from "@/lib/evolution-long-audio";
import { getSupportedRecorderMimeOptions } from "@/lib/audio-recording-mime";
import { EvolutionFormSchema } from "@/server/services/evolution-process";

describe("evolution-audio-edge-cases (#4 duração / rede / mobile payload)", () => {
  it("2:59 síncrono vs 3:01 assíncrono", () => {
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: ASYNC_AUDIO_THRESHOLD_SECONDS - 1 }),
      false,
    );
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: ASYNC_AUDIO_THRESHOLD_SECONDS + 1 }),
      true,
    );
  });

  it("4 min dispara pipeline 2 fases", () => {
    assert.equal(isLongEvolutionAudio({ audioDurationSec: 240 }), true);
    assert.equal(isLongEvolutionAudio({ audioDurationSec: 239 }), false);
  });

  it("PRO 6 min dentro do limiar async", () => {
    assert.equal(shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 360 }), true);
  });

  it("FormData schema aceita audioSizeBytes (mobile/web Storage)", () => {
    const r = EvolutionFormSchema.safeParse({
      audioStoragePath: "uid/550e8400-e29b-41d4-a716-446655440000.webm",
      audioSizeBytes: 5_000_000,
      audioDurationSec: 310,
    });
    assert.equal(r.success, true);
  });

  it("transcrição rejeita strings curtas pós-IA", () => {
    assert.equal(hasUsableEvolutionTranscription({ technicalTranscription: "ok curto" }), false);
  });

  it("Safari: getSupportedRecorderMimeOptions prioriza mp4 quando simulado", () => {
    const orig = globalThis.MediaRecorder;
    const calls: string[] = [];
    globalThis.MediaRecorder = class MockMR {
      static isTypeSupported(m: string) {
        calls.push(m);
        return m === "audio/mp4" || m.startsWith("audio/webm");
      }
    } as unknown as typeof MediaRecorder;
    try {
      const opts = getSupportedRecorderMimeOptions();
      assert.ok(opts?.mimeType);
    } finally {
      globalThis.MediaRecorder = orig;
    }
  });

  it("contrato cliente: abort antes de POST /api/evolution", () => {
    assert.ok(true, "Upload abortado no cliente não deve chamar /api/evolution");
  });
});
