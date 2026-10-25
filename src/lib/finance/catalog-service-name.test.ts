import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalogServiceFields } from "./catalog-service-name";

test("normalizeCatalogServiceFields encurta nome longo e move resto para descrição", () => {
  const longName = "A".repeat(250);
  const { name, description } = normalizeCatalogServiceFields(longName);
  assert.equal(name.length, 200);
  assert.equal(description?.length, 50);
});

test("normalizeCatalogServiceFields divide em separador quando possível", () => {
  const prefix = `${"Serviço premium ".repeat(12)}`.slice(0, 190);
  const { name, description } = normalizeCatalogServiceFields(
    `${prefix} - inclui avaliação postural completa e plano de exercícios`,
    null,
  );
  assert.ok(name.length <= 200);
  assert.ok(description && description.length > 0);
});
