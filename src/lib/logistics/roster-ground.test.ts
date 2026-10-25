import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpretLogisticsTranscript } from "@/lib/logistics/interpret-command";
import { groundTasksOnRoster, type RosterEntry } from "@/lib/logistics/roster-ground";

const NOW = new Date("2026-10-24T22:04:00.000Z");

const clients: RosterEntry[] = [
  { name: "Helena Prado", aliases: ["Helena do Centro"] },
  { name: "Lívia Nunes" },
];

const couriers: RosterEntry[] = [{ name: "Caio Mendes" }, { name: "Davi Lopes" }];

function ground(transcript: string, clientList = clients, courierList = couriers) {
  return groundTasksOnRoster(transcript, interpretLogisticsTranscript(transcript, NOW), clientList, courierList);
}

describe("nomes do cadastro em qualquer ordem", () => {
  it("acha profissional e entregador que a frase não apresentou com o papel", () => {
    const tasks = ground("Entrega amanhã até às cinco da tarde Helena Caio.");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.clientName, "Helena Prado");
    assert.equal(tasks[0]?.courierName, "Caio Mendes");
    assert.equal(tasks[0]?.targetDate, "2026-10-25");
    assert.equal(tasks[0]?.timeWindowEnd, "17:00");
  });

  it("reconhece o entregador antes do profissional", () => {
    const tasks = ground("Caio entrega amanhã até às cinco da tarde para a doutora Lívia.");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.clientName, "Lívia Nunes");
    assert.equal(tasks[0]?.courierName, "Caio Mendes");
  });

  it("não troca um nome novo por alguém do cadastro", () => {
    const tasks = ground("Entregar no Otavio amanhã até às cinco da tarde.");
    assert.equal(tasks[0]?.clientName, "Otavio");
    assert.equal(tasks[0]?.courierName, null);
  });

  it("pede o sobrenome quando há duas pessoas com o mesmo primeiro nome", () => {
    const repeated: RosterEntry[] = [
      { name: "Helena Prado" },
      { name: "Helena Dias" },
    ];
    const open = ground("Entrega amanhã Helena Caio.", repeated, couriers);
    assert.equal(open[0]?.clientName, "Helena");
    assert.equal(open[0]?.courierName, "Caio Mendes");

    const closed = ground("Entrega amanhã Helena Dias e o Caio.", repeated, couriers);
    assert.equal(closed[0]?.clientName, "Helena Dias");
    assert.equal(closed[0]?.courierName, "Caio Mendes");
  });

  it("aproxima um primeiro nome único com uma letra a mais", () => {
    const tasks = ground("Entrega amanhã Helenah.", [{ name: "Helena Prado" }], []);
    assert.equal(tasks[0]?.clientName, "Helena Prado");
  });

  it("não coloca o entregador no lugar do profissional quando o nome está nas duas listas", () => {
    const tasks = ground(
      "Entrega amanhã Caio.",
      [{ name: "Caio Prado" }],
      [{ name: "Caio Mendes" }],
    );
    assert.equal(tasks[0]?.clientName, null);
    assert.equal(tasks[0]?.courierName, null);
  });
});
