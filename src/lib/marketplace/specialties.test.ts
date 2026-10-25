import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { professionOptions } from "@/lib/profession-options";
import {
  MARKETPLACE_SPECIALTY_CATALOG,
  matchingSpecialtySlugs,
  specialtySlugFromProfession,
} from "@/lib/marketplace/specialties";

describe("specialties", () => {
  it("espelha o dropdown de cadastro", () => {
    assert.equal(MARKETPLACE_SPECIALTY_CATALOG.length, professionOptions.length);
    assert.deepEqual(
      MARKETPLACE_SPECIALTY_CATALOG.map((item) => item.name),
      professionOptions.map((item) => item.label),
    );
  });

  it("mapeia profissão do cadastro para slug", () => {
    assert.equal(specialtySlugFromProfession("Fisioterapeuta"), "fisioterapeuta");
    assert.equal(specialtySlugFromProfession("Nutricionista"), "nutricionista");
    assert.equal(specialtySlugFromProfession("Cirurgiao-Dentista"), "cirurgiao-dentista");
    assert.equal(specialtySlugFromProfession("Cirurgião-Dentista"), "cirurgiao-dentista");
    assert.equal(specialtySlugFromProfession("desconhecida"), "fisioterapeuta");
  });

  it("tem slugs únicos", () => {
    const slugs = MARKETPLACE_SPECIALTY_CATALOG.map((item) => item.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.ok(slugs.includes("fisioterapeuta"));
    assert.equal(slugs.includes("rpg"), false);
  });

  it("aceita nome do cadastro e slug legado na busca", () => {
    assert.deepEqual(matchingSpecialtySlugs("Fisioterapeuta"), ["fisioterapeuta"]);
    assert.deepEqual(matchingSpecialtySlugs("fisioterapia"), ["fisioterapeuta"]);
    assert.deepEqual(matchingSpecialtySlugs("rpg"), []);
  });
});
