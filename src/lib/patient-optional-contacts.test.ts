import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contactsFromProfileForm,
  mergeOptionalContactsKeepExisting,
  parseOptionalContactsFromAi,
  sanitizeOptionalPhone,
} from "./patient-optional-contacts";

describe("patient-optional-contacts", () => {
  it("sanitizeOptionalPhone remove letras e preserva dígitos", () => {
    assert.equal(sanitizeOptionalPhone("tel (11) 98888-0000"), "(11) 98888-0000");
    assert.equal(sanitizeOptionalPhone("  "), null);
  });

  it("parseOptionalContactsFromAi ignora vazios e tipos errados", () => {
    const parsed = parseOptionalContactsFromAi({
      telefone: "11999990000",
      nomePai: "João",
      nomeMae: "",
      idade: "10",
    });
    assert.equal(parsed.telefone, "11999990000");
    assert.equal(parsed.nomePai, "João");
    assert.equal(parsed.nomeMae, undefined);
  });

  it("mergeOptionalContactsKeepExisting não apaga ficha com IA vazia", () => {
    const merged = mergeOptionalContactsKeepExisting(
      { telefone: "", nomePai: "Carlos" },
      { phone: "113333", fatherName: "Old", motherName: "Ana", companionName: null, companionPhone: null },
    );
    assert.equal(merged.phone, "113333");
    assert.equal(merged.fatherName, "Carlos");
    assert.equal(merged.motherName, "Ana");
  });

  it("contactsFromProfileForm limpa campo vazio", () => {
    const saved = contactsFromProfileForm({
      telefone: "",
      nomeMae: "Helena",
    });
    assert.equal(saved.phone, null);
    assert.equal(saved.motherName, "Helena");
  });

  it("parseOptionalContactsFromAi aceita chaves em inglês da importação", () => {
    const parsed = parseOptionalContactsFromAi({
      phone: "11911112222",
      fatherName: "Pedro",
      companionName: "Tia Lúcia",
      companionPhone: "11900001111",
    });
    assert.equal(parsed.telefone, "11911112222");
    assert.equal(parsed.nomePai, "Pedro");
    assert.equal(parsed.nomeAcompanhante, "Tia Lúcia");
    assert.equal(parsed.telefoneAcompanhante, "11900001111");
  });
});
