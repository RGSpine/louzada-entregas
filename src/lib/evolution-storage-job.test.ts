import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EvolutionJobPayloadSchema } from "@/lib/evolution-job-worker";
import { shouldUseAsyncAudioMode } from "@/lib/evolution-hybrid";
import { inferMimeFromStoragePath } from "@/lib/uploads/direct-upload";

describe("EvolutionJobPayloadSchema — áudio via Storage (fase 2)", () => {
  it("aceita job só com audioStoragePath (sem base64)", () => {
    const r = EvolutionJobPayloadSchema.safeParse({
      mergeMode: false,
      audioBase64: null,
      audioStoragePath: "user-uuid/550e8400-e29b-41d4-a716-446655440000.webm",
      audioMimeForModel: "audio/webm",
      audioDurationSec: 310,
      examFiles: [],
    });
    assert.equal(r.success, true);
  });

  it("rejeita audioStoragePath e audioBase64 juntos", () => {
    const r = EvolutionJobPayloadSchema.safeParse({
      mergeMode: false,
      audioBase64: "abc",
      audioStoragePath: "user/u.webm",
      audioMimeForModel: "audio/webm",
      examFiles: [],
    });
    assert.equal(r.success, false);
  });

  it("inferMimeFromStoragePath mapeia extensão do path", () => {
    assert.equal(
      inferMimeFromStoragePath("uid/550e8400-e29b-41d4-a716-446655440000.webm", "audio"),
      "audio/webm",
    );
  });

  it("async por duração com path deferido (sem bytes)", () => {
    assert.equal(
      shouldUseAsyncAudioMode({ hasAudio: true, audioDurationSec: 300 }),
      true,
    );
  });
});
