import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import {
  distanceKm,
  parseShowcaseSearch,
  professionSearchValues,
  showcaseSlotWindow,
} from "@/lib/marketplace/showcase-search";

test("médico com acento encontra o valor cadastrado", () => {
  assert.deepEqual(professionSearchValues("médico"), ["Medico"]);
});

test("hora sem dia é ignorada", () => {
  const search = parseShowcaseSearch({ horario: "14:30" });
  assert.equal(search.time, null);
  assert.equal(search.day, null);
  assert.equal(search.radiusKm, null);
});

test("raio sem localização é ignorado", () => {
  const search = parseShowcaseSearch({ raio: "10", cidade: "Ribeirão Preto" });
  assert.equal(search.radiusKm, null);
  assert.equal(search.city, "Ribeirão Preto");
});

test("raio e coordenadas válidos entram na busca", () => {
  const search = parseShowcaseSearch({
    raio: "25",
    lat: "-21.17",
    lng: "-47.81",
    bairro: "Jardim Botânico",
  });
  assert.equal(search.radiusKm, 25);
  assert.equal(search.latitude, -21.17);
  assert.equal(search.longitude, -47.81);
  assert.equal(search.neighborhood, "Jardim Botânico");
});

test("dia inteiro cobre a meia-noite de Brasília", () => {
  const window = showcaseSlotWindow("2026-10-20", null);
  assert.ok(window);
  const start = DateTime.fromJSDate(window.start, { zone: "America/Sao_Paulo" });
  const end = DateTime.fromJSDate(window.end, { zone: "America/Sao_Paulo" });
  assert.equal(start.toISO(), "2026-10-20T00:00:00.000-03:00");
  assert.equal(end.toISO(), "2026-10-21T00:00:00.000-03:00");
  assert.equal(window.instant, null);
});

test("distância curta em Ribeirão Preto fica abaixo de 5 km", () => {
  const km = distanceKm(
    { latitude: -21.1775, longitude: -47.8103 },
    { latitude: -21.19, longitude: -47.8 },
  );
  assert.ok(km > 0 && km < 5);
});

test("horário pedido é o instante em Brasília", () => {
  const window = showcaseSlotWindow("2026-10-20", "14:30");
  assert.ok(window?.instant);
  const instant = DateTime.fromJSDate(window.instant, { zone: "America/Sao_Paulo" });
  assert.equal(instant.toISO(), "2026-10-20T14:30:00.000-03:00");
});
