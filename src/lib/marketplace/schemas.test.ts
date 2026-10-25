import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_TAKEN_MESSAGE,
  bookScheduleSlotSchema,
  groupMarketplaceSearchRows,
  searchProfessionalsSchema,
  toMoneyNumber,
  type MarketplaceSearchRow,
} from "@/lib/marketplace/schemas";

const BASE_ROW: MarketplaceSearchRow = {
  profileId: "prof_1",
  userId: "user_1",
  professionalName: "Dra. Ana",
  profession: "Fisioterapeuta",
  avatarUrl: null,
  image: "https://img.example/ana.png",
  publicPhotoUrl: null,
  publicBio: "Atendimento ortopédico e pilates clínico.",
  publicHeadline: "Fisio ortopédica em Pinheiros",
  mapsUrl: "https://maps.app.goo.gl/example",
  city: "São Paulo",
  state: "SP",
  neighborhood: "Pinheiros",
  latitude: -23.561,
  longitude: -46.656,
  yieldManagementEnabled: true,
  distanceMeters: 1500,
  specialtyId: "spec_fisio",
  specialtyName: "Fisioterapia",
  specialtySlug: "fisioterapia",
  slotId: "slot_yield",
  datetime: new Date("2026-09-27T13:00:00.000Z"),
  endAt: new Date("2026-09-27T14:00:00.000Z"),
  basePrice: "200.00",
  yieldActive: true,
  discountPrice: "140.00",
};

describe("searchProfessionalsSchema", () => {
  it("aceita payload válido e aplica default de raio", () => {
    const parsed = searchProfessionalsSchema.safeParse({
      latitude: -23.55,
      longitude: -46.63,
      specialty: "fisioterapia",
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.radiusKm, 10);
      assert.equal(parsed.data.specialty, "fisioterapia");
    }
  });

  it("rejeita latitude fora do intervalo e especialidade vazia", () => {
    assert.equal(
      searchProfessionalsSchema.safeParse({
        latitude: 120,
        longitude: -46.63,
        specialty: "fisio",
      }).success,
      false,
    );
    assert.equal(
      searchProfessionalsSchema.safeParse({
        latitude: -23.55,
        longitude: -46.63,
        specialty: "   ",
      }).success,
      false,
    );
  });
});

describe("bookScheduleSlotSchema", () => {
  it("aceita slotId e rejeita vazio", () => {
    assert.equal(bookScheduleSlotSchema.safeParse({ slotId: "slot_1" }).success, true);
    assert.equal(bookScheduleSlotSchema.safeParse({ slotId: "  " }).success, false);
  });
});

describe("groupMarketplaceSearchRows", () => {
  it("agrupa slots, prioriza yield já ordenado e calcula preço efetivo", () => {
    const grouped = groupMarketplaceSearchRows([
      BASE_ROW,
      {
        ...BASE_ROW,
        slotId: "slot_regular",
        yieldActive: false,
        discountPrice: null,
        datetime: new Date("2026-09-27T15:00:00.000Z"),
        endAt: new Date("2026-09-27T16:00:00.000Z"),
      },
      {
        ...BASE_ROW,
        slotId: "slot_yield",
        specialtyId: "spec_rpg",
        specialtyName: "RPG",
        specialtySlug: "rpg",
      },
    ]);

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.distanceKm, 1.5);
    assert.equal(grouped[0]?.avatarUrl, "https://img.example/ana.png");
    assert.equal(grouped[0]?.publicHeadline, "Fisio ortopédica em Pinheiros");
    assert.equal(grouped[0]?.mapsUrl, "https://maps.app.goo.gl/example");
    assert.equal(grouped[0]?.specialties.length, 2);
    assert.deepEqual(
      grouped[0]?.slots.map((slot) => slot.id),
      ["slot_yield", "slot_regular"],
    );
    assert.equal(grouped[0]?.slots[0]?.effectivePrice, 140);
    assert.equal(grouped[0]?.slots[1]?.effectivePrice, 200);
  });
});

describe("toMoneyNumber", () => {
  it("arredonda valores monetários", () => {
    assert.equal(toMoneyNumber("140.499"), 140.5);
    assert.equal(toMoneyNumber(null), 0);
  });
});

describe("SLOT_TAKEN_MESSAGE", () => {
  it("mantém a mensagem amigável de corrida", () => {
    assert.equal(SLOT_TAKEN_MESSAGE, "Horário recém-reservado");
  });
});
