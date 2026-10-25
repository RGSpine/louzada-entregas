import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectPdfLogoFormat,
  parseDataUrlLogo,
} from "./pdf-clinic-logo";

describe("pdf-clinic-logo", () => {
  it("detecta JPEG/PNG/WEBP pelo mime ou extensão", () => {
    assert.equal(detectPdfLogoFormat("image/jpeg"), "JPEG");
    assert.equal(detectPdfLogoFormat("https://x/logo.PNG"), "PNG");
    assert.equal(detectPdfLogoFormat("image/webp"), "WEBP");
  });

  it("parseia data URL", () => {
    const parsed = parseDataUrlLogo("data:image/png;base64,QUJD");
    assert.deepEqual(parsed, { data: "QUJD", format: "PNG" });
    assert.equal(parseDataUrlLogo("https://cdn.example/logo.png"), null);
  });
});
