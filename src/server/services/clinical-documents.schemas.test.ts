import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GenerateClinicalDocumentInputSchema } from "@/server/services/clinical-documents";

const VALID_UUID = "3f0a4c9e-8a1b-4f4d-9c6e-2b7d8a1c5e90";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    patientId: VALID_UUID,
    documentType: "exam_request",
    transcription: "Solicito hemograma completo e glicemia de jejum.",
    ...overrides,
  };
}

describe("GenerateClinicalDocumentInputSchema (POST /api/v1/documents/generate)", () => {
  it("aceita payload mínimo válido e aplica default em destinationEmail", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(validPayload());
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.destinationEmail, "");
    }
  });

  it("rejeita patientId que não é UUID", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ patientId: "123" }),
    );
    assert.equal(r.success, false);
  });

  it("rejeita transcription curta (<10 caracteres)", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ transcription: "curto" }),
    );
    assert.equal(r.success, false);
  });

  it("rejeita destinationEmail inválido (não vazio)", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ destinationEmail: "nao-e-email" }),
    );
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes("destinationEmail")));
    }
  });

  it("aceita destinationEmail válido", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ destinationEmail: "paciente@example.com" }),
    );
    assert.equal(r.success, true);
  });

  it("aceita professionalEmail vazio (string literal '')", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ professionalEmail: "" }),
    );
    assert.equal(r.success, true);
  });

  it("rejeita professionalEmail inválido", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ professionalEmail: "abc" }),
    );
    assert.equal(r.success, false);
  });

  it("aceita logo null", () => {
    const r = GenerateClinicalDocumentInputSchema.safeParse(
      validPayload({ logo: null }),
    );
    assert.equal(r.success, true);
  });
});
