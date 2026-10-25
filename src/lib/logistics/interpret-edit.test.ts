import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretLogisticsEdits } from "@/lib/logistics/interpret-edit";
import { interpretLogisticsTranscript } from "@/lib/logistics/interpret-command";

const NOW = new Date("2026-10-24T22:04:00.000Z");

describe("alteração de marcação", () => {
  it("muda a data e o horário da coleta", () => {
    const [edit] = interpretLogisticsEdits("Muda a coleta do Rodrigo para amanhã às cinco da tarde.", NOW);
    assert.equal(edit?.matchType, "COLETA");
    assert.equal(edit?.matchClientName, "Rodrigo");
    assert.equal(edit?.targetDate, "2026-10-25");
    assert.equal(edit?.timeWindowEnd, "17:00");
    assert.equal(edit?.courierName, null);
    assert.equal(edit?.type, null);
  });

  it("troca o entregador", () => {
    const [edit] = interpretLogisticsEdits("Troca o entregador da coleta do Rodrigo para Roberto.", NOW);
    assert.equal(edit?.matchClientName, "Rodrigo");
    assert.equal(edit?.courierName, "Roberto");
    assert.equal(edit?.targetDate, null);
  });

  it("troca coleta por entrega", () => {
    const [edit] = interpretLogisticsEdits("A coleta do Rodrigo passa a ser entrega.", NOW);
    assert.equal(edit?.matchType, "COLETA");
    assert.equal(edit?.type, "ENTREGA");
    assert.equal(edit?.clientName, null);
  });

  it("troca o cliente", () => {
    const [edit] = interpretLogisticsEdits("Muda o cliente da coleta do Rodrigo para Marcelo.", NOW);
    assert.equal(edit?.clientName, "Marcelo");
    assert.equal(edit?.matchClientName, "Rodrigo");
    assert.equal(edit?.courierName, null);
  });

  it("tira o entregador", () => {
    const [edit] = interpretLogisticsEdits("Tira o entregador da entrega do Marcelo.", NOW);
    assert.equal(edit?.clearCourier, true);
    assert.equal(edit?.matchType, "ENTREGA");
    assert.equal(edit?.matchClientName, "Marcelo");
  });

  it("usa a data de origem e a data nova", () => {
    const [edit] = interpretLogisticsEdits("Muda a coleta do Rodrigo de amanhã para hoje às quatro da tarde.", NOW);
    assert.equal(edit?.matchDate, "2026-10-25");
    assert.equal(edit?.targetDate, "2026-10-24");
    assert.equal(edit?.timeWindowEnd, "16:00");
  });

  it("ignora o prefixo doutora ao achar a coleta", () => {
    const [edit] = interpretLogisticsEdits("Muda a coleta da doutora Adriana para amanhã às cinco da tarde.", NOW);
    assert.equal(edit?.matchClientName, "Adriana");
    assert.equal(edit?.targetDate, "2026-10-25");
    assert.equal(edit?.timeWindowEnd, "17:00");
  });

  it("marca a coleta como realizada", () => {
    const [edit] = interpretLogisticsEdits("Marca a coleta da doutora Adriana como realizada.", NOW);
    assert.equal(edit?.matchType, "COLETA");
    assert.equal(edit?.matchClientName, "Adriana");
    assert.equal(edit?.status, "CONCLUIDO");
    assert.equal(edit?.targetDate, null);
  });

  it("cancela a entrega pelo áudio", () => {
    const [edit] = interpretLogisticsEdits("Cancela a entrega do Marcelo.", NOW);
    assert.equal(edit?.matchType, "ENTREGA");
    assert.equal(edit?.matchClientName, "Marcelo");
    assert.equal(edit?.status, "CANCELADO");
  });

  it("não trata um comando novo como alteração", () => {
    const transcript = "Hoje precisa coletar no dr.Marcelo, até às cinco horas da tarde";
    assert.equal(interpretLogisticsEdits(transcript, NOW).length, 0);
    assert.equal(interpretLogisticsTranscript(transcript, NOW).length, 1);
  });
});
