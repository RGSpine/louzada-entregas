import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_AUDIO_BYTES, MAX_EXAM_BYTES } from "@/lib/evolution-hybrid";
import {
  SignUploadSchema,
  isStorageResourceMissingError,
  normalizeContentType,
} from "@/lib/uploads/direct-upload";

describe("SignUploadSchema (POST /api/v1/uploads/sign)", () => {
  it("aceita áudio webm válido", () => {
    const r = SignUploadSchema.safeParse({
      kind: "audio",
      contentType: "audio/webm",
      sizeBytes: 1024,
    });
    assert.equal(r.success, true);
  });

  it("aceita exame PDF dentro do limite", () => {
    const r = SignUploadSchema.safeParse({
      kind: "exam",
      contentType: "application/pdf",
      sizeBytes: MAX_EXAM_BYTES,
    });
    assert.equal(r.success, true);
  });

  it("rejeita kind inválido", () => {
    const r = SignUploadSchema.safeParse({
      kind: "video",
      contentType: "audio/webm",
      sizeBytes: 100,
    });
    assert.equal(r.success, false);
  });

  it("rejeita sizeBytes acima do limite de exame", () => {
    const r = SignUploadSchema.safeParse({
      kind: "exam",
      contentType: "image/jpeg",
      sizeBytes: MAX_EXAM_BYTES + 1,
    });
    assert.equal(r.success, false);
  });

  it("rejeita sizeBytes acima do limite de áudio", () => {
    const r = SignUploadSchema.safeParse({
      kind: "audio",
      contentType: "audio/mp4",
      sizeBytes: MAX_AUDIO_BYTES + 1,
    });
    assert.equal(r.success, false);
  });

  it("rejeita contentType vazio", () => {
    const r = SignUploadSchema.safeParse({
      kind: "audio",
      contentType: "",
      sizeBytes: 100,
    });
    assert.equal(r.success, false);
  });
});

describe("normalizeContentType", () => {
  it("remove parâmetros e normaliza jpg", () => {
    assert.equal(normalizeContentType("Audio/WebM; codecs=opus"), "audio/webm");
    assert.equal(normalizeContentType("image/jpg"), "image/jpeg");
  });
});

describe("isStorageResourceMissingError", () => {
  it("detecta bucket not found clássico", () => {
    assert.equal(isStorageResourceMissingError("Bucket not found"), true);
  });

  it("detecta mensagem atual do Supabase Storage", () => {
    assert.equal(
      isStorageResourceMissingError("The related resource does not exist"),
      true,
    );
  });

  it("ignora outros erros", () => {
    assert.equal(isStorageResourceMissingError("Invalid JWT"), false);
  });
});
