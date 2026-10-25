import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EvolutionFormSchema } from "@/server/services/evolution-process";

describe("EvolutionFormSchema (POST /api/v1/evolution FormData fields)", () => {
  it("aceita audioStoragePath como alternativa ao áudio inline", () => {
    const r = EvolutionFormSchema.safeParse({
      mergeMode: false,
      revisionMode: false,
      audioStoragePath: "user-uuid/550e8400-e29b-41d4-a716-446655440000.m4a",
    });
    assert.equal(r.success, true);
  });

  it("rejeita audioStoragePath acima de 300 caracteres", () => {
    const r = EvolutionFormSchema.safeParse({
      mergeMode: false,
      revisionMode: false,
      audioStoragePath: "x".repeat(301),
    });
    assert.equal(r.success, false);
  });

  it("rejeita revisionContent acima de 200k", () => {
    const r = EvolutionFormSchema.safeParse({
      mergeMode: false,
      revisionMode: true,
      revisionContent: "a".repeat(200_001),
    });
    assert.equal(r.success, false);
  });

  it("aplica defaults em mergeMode e revisionMode", () => {
    const r = EvolutionFormSchema.safeParse({});
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.mergeMode, false);
      assert.equal(r.data.revisionMode, false);
      assert.equal(r.data.clinicalContinuation, false);
    }
  });
});
