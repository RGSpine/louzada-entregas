import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hearLogisticsMoney } from "@/lib/logistics/money";
import { matchProsthesisPrice } from "@/lib/logistics/prosthesis-price";

describe("valor e pagamento no áudio", () => {
  it("lê reais, pix e não confunde horário com dinheiro", () => {
    const money = hearLogisticsMoney(
      "Hoje entregar no Marcelo a coroa, 800 reais no pix, até às seis da tarde",
    );
    assert.equal(money.amountCents, 80000);
    assert.equal(money.paymentMethod, "PIX");

    const clock = hearLogisticsMoney("coletar no Marcelo até às cinco horas da tarde");
    assert.equal(clock.amountCents, null);
    assert.equal(clock.paymentMethod, null);
  });

  it("lê real com centavos e valor por extenso", () => {
    assert.equal(hearLogisticsMoney("R$ 1.250,50 em dinheiro").amountCents, 125050);
    assert.equal(hearLogisticsMoney("R$ 1.250,50 em dinheiro").paymentMethod, "CASH");
    assert.equal(hearLogisticsMoney("oitocentos reais no cartão").amountCents, 80000);
    assert.equal(hearLogisticsMoney("oitocentos reais no cartão").paymentMethod, "CARD");
  });
});

describe("catálogo de prótese", () => {
  const catalog = [
    { name: "Coroa", defaultPriceCents: 40000 },
    { name: "Coroa de porcelana", defaultPriceCents: 90000 },
  ];

  it("usa o nome mais específico citado e ignora horário", () => {
    assert.equal(matchProsthesisPrice("entregar coroa de porcelana no Marcelo", catalog), 90000);
    assert.equal(matchProsthesisPrice("entregar coroa no Marcelo", catalog), 40000);
    assert.equal(matchProsthesisPrice("até às cinco", catalog), null);
  });
});
