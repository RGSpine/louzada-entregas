import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskProfessionalPublicName } from "@/lib/marketplace/display";

describe("maskProfessionalPublicName", () => {
  it("mostra primeiro nome e inicial do sobrenome", () => {
    assert.equal(maskProfessionalPublicName("Ana Souza"), "Ana S.");
    assert.equal(maskProfessionalPublicName("Maria Clara Nunes"), "Maria N.");
  });

  it("mantém um único nome", () => {
    assert.equal(maskProfessionalPublicName("Ana"), "Ana");
  });

  it("usa um rótulo quando o nome vem vazio", () => {
    assert.equal(maskProfessionalPublicName("   "), "Profissional");
  });
});
