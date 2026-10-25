import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVOLUTION_UPLOAD_TOAST_ADDITIONAL,
  EVOLUTION_UPLOAD_TOAST_MAIN,
} from "@/lib/evolution-upload-toast";

describe("evolution-upload-toast — IDs estáveis", () => {
  it("usa IDs fixos para evitar toasts duplicados", () => {
    assert.equal(EVOLUTION_UPLOAD_TOAST_MAIN, "evolution-audio-upload-main");
    assert.equal(
      EVOLUTION_UPLOAD_TOAST_ADDITIONAL,
      "evolution-audio-upload-additional",
    );
    assert.notEqual(EVOLUTION_UPLOAD_TOAST_MAIN, EVOLUTION_UPLOAD_TOAST_ADDITIONAL);
  });
});
