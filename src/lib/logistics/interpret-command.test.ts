import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretLogisticsTranscript } from "@/lib/logistics/interpret-command";
import { matchDentistClient } from "@/lib/logistics/fuzzy-dentist";
import { resolveLogisticsDate, resolveLogisticsTime } from "@/lib/logistics/temporal-resolve";

const NOW = new Date("2026-10-24T22:04:00.000Z");

describe("contexto temporal do comando", () => {
  it("ancora hoje, ontem, amanhã e semana que vem em America/Sao_Paulo", () => {
    assert.equal(resolveLogisticsDate("hoje", NOW), "2026-10-24");
    assert.equal(resolveLogisticsDate("ontem", NOW), "2026-10-23");
    assert.equal(resolveLogisticsDate("amanhã", NOW), "2026-10-25");
    assert.equal(resolveLogisticsDate("semana que vem", NOW), "2026-10-26");
    assert.equal(resolveLogisticsTime("cinco horas da tarde"), "17:00");
    assert.equal(resolveLogisticsTime("seis da tarde"), "18:00");
    assert.equal(resolveLogisticsTime("meio-dia"), "12:00");
  });

  it("separa coleta e entrega e amarra cada uma à data e à hora", () => {
    const tasks = interpretLogisticsTranscript(
      "Hoje precisa coletar no dr.Marcelo, até às cinco horas da tarde/Hoje precisa entregar até às seis da tarde",
      NOW,
    );
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks[0], {
      type: "COLETA",
      clientName: "Marcelo",
      courierName: null,
      workDescription: null,
      targetDate: "2026-10-24",
      timeWindowStart: null,
      timeWindowEnd: "17:00",
      amountCents: null,
      paymentMethod: null,
    });
    assert.equal(tasks[1]?.type, "ENTREGA");
    assert.equal(tasks[1]?.clientName, null);
    assert.equal(tasks[1]?.targetDate, "2026-10-24");
    assert.equal(tasks[1]?.timeWindowEnd, "18:00");
  });

  it("marca a coleta do doutor Rodrigo amanhã às cinco, sem tratar entregador como entrega", () => {
    const tasks = interpretLogisticsTranscript(
      "O entregador Roberto irá, é, coletar um material no Doutor Rodrigo amanhã às cinco horas da tarde.",
      NOW,
    );
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0], {
      type: "COLETA",
      clientName: "Rodrigo",
      courierName: "Roberto",
      workDescription: "Material",
      targetDate: "2026-10-25",
      timeWindowStart: null,
      timeWindowEnd: "17:00",
      amountCents: null,
      paymentMethod: null,
    });
  });

  it("manda valor e forma de pagamento para o lançamento, sem misturar com o horário", () => {
    const tasks = interpretLogisticsTranscript(
      "Hoje entregar no Marcelo a coroa, 800 reais no pix, até às seis da tarde",
      NOW,
    );
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.type, "ENTREGA");
    assert.equal(tasks[0]?.clientName, "Marcelo");
    assert.equal(tasks[0]?.targetDate, "2026-10-24");
    assert.equal(tasks[0]?.timeWindowEnd, "18:00");
    assert.equal(tasks[0]?.amountCents, 80000);
    assert.equal(tasks[0]?.paymentMethod, "PIX");
  });
});

describe("fuzzy match do dentista", () => {
  it("vincula apelido claro e guarda o nome ouvido quando não há match", () => {
    const candidates = [
      {
        id: "dent-1",
        name: "Marcelo Andrade",
        clinicName: "Núcleo",
        address: "Rua A, 10",
        aliases: ["Marcelo da Núcleo"],
      },
    ];
    const hit = matchDentistClient("Marcelo da Núcleo", candidates);
    assert.equal(hit.dentistClientId, "dent-1");
    assert.equal(hit.address, "Rua A, 10");

    const miss = matchDentistClient("Celso Parcellini", candidates);
    assert.equal(miss.dentistClientId, null);
    assert.equal(miss.rawClientName, "Celso Parcellini");
  });
});
