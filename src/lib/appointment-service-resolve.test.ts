import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatalogServiceForAppointment,
  resolveServiceIdByUniquePrice,
} from "./appointment-service-resolve";

const catalog = [
  { id: "s1", name: "Consulta Nutrição", defaultPriceCents: 20000 },
  { id: "s2", name: "Retorno", defaultPriceCents: 15000 },
  { id: "s3", name: "Fisioterapia", defaultPriceCents: 20000 },
];

test("resolveCatalogServiceForAppointment prioriza nome do serviço", () => {
  const match = resolveCatalogServiceForAppointment({
    serviceNameGuess: "nutrição",
    priceCents: 15000,
    services: catalog,
  });
  assert.equal(match?.id, "s1");
});

test("resolveCatalogServiceForAppointment usa preço único no catálogo", () => {
  const match = resolveCatalogServiceForAppointment({
    serviceNameGuess: null,
    priceCents: 15000,
    services: catalog,
  });
  assert.equal(match?.id, "s2");
});

test("resolveServiceIdByUniquePrice ignora preço ambíguo", () => {
  assert.equal(resolveServiceIdByUniquePrice(20000, catalog), null);
});
