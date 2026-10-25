import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SaveEvolutionApiSchema } from "@/server/services/evolution-save";

describe("SaveEvolutionApiSchema (POST /api/v1/evolution/save)", () => {
  it("aceita payload mínimo válido", () => {
    const r = SaveEvolutionApiSchema.safeParse({
      patientName: "Eric",
      content: "Paciente com dor no joelho.",
    });
    assert.equal(r.success, true);
  });

  it("rejeita content vazio", () => {
    const r = SaveEvolutionApiSchema.safeParse({
      patientName: "Eric",
      content: "   ",
    });
    assert.equal(r.success, false);
  });

  it("rejeita patientName vazio", () => {
    const r = SaveEvolutionApiSchema.safeParse({
      patientName: "",
      content: "texto",
    });
    assert.equal(r.success, false);
  });
});
