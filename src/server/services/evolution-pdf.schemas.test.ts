import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GenerateEvolutionPdfSchema } from "@/server/services/evolution-pdf";

describe("GenerateEvolutionPdfSchema (POST /api/v1/evolution/pdf)", () => {
  it("aceita payload mínimo válido", () => {
    const r = GenerateEvolutionPdfSchema.safeParse({
      patientName: "Maria Silva",
      content: "Evolução clínica detalhada com mais de dez caracteres.",
    });
    assert.equal(r.success, true);
  });

  it("rejeita content vazio", () => {
    const r = GenerateEvolutionPdfSchema.safeParse({
      patientName: "Maria",
      content: "",
    });
    assert.equal(r.success, false);
  });

  it("rejeita patientName vazio", () => {
    const r = GenerateEvolutionPdfSchema.safeParse({
      patientName: "  ",
      content: "Conteúdo válido da evolução clínica.",
    });
    assert.equal(r.success, false);
  });
});
