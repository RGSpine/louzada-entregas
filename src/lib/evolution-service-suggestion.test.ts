import assert from "node:assert/strict";
import test from "node:test";
import { detectEvolutionServiceSuggestion } from "./evolution-service-suggestion";

const services = [
  { id: "svc-1", name: "Consulta inicial", defaultPriceCents: 25000 },
  { id: "svc-2", name: "Pilates clínico", defaultPriceCents: 18000 },
];

test("detecta termo exato do catálogo ignorando acentos e caixa", () => {
  assert.deepEqual(
    detectEvolutionServiceSuggestion(
      "Paciente realizou hoje PILATES CLINICO com boa tolerância.",
      services,
    ),
    {
      serviceId: "svc-2",
      serviceName: "Pilates clínico",
      defaultPriceCents: 18000,
      confidence: "CATALOG_TERM_EXACT",
    },
  );
});

test("não sugere quando há dois serviços distintos no mesmo texto", () => {
  assert.equal(
    detectEvolutionServiceSuggestion(
      "Foi discutida consulta inicial e também Pilates clínico.",
      services,
    ),
    null,
  );
});

test("não faz correspondência parcial dentro de outra palavra", () => {
  assert.equal(
    detectEvolutionServiceSuggestion("A paciente consultava registros antigos.", [
      { id: "generic", name: "Consulta", defaultPriceCents: 10000 },
    ]),
    null,
  );
});
