import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLogisticsIntake } from "@/lib/logistics/intake-schema";

describe("parseLogisticsIntake", () => {
  it("aceita várias ordens no mesmo áudio", () => {
    const result = parseLogisticsIntake({
      tasks: [
        {
          type: "COLETA",
          clientName: "Marcelo da Núcleo",
          workDescription: "Serviço Marina",
          targetDate: "2026-10-24",
          timeWindowStart: "09:00",
          timeWindowEnd: "11:30",
        },
        {
          type: "ENTREGA",
          clientName: "Clínica Oliveira",
          workDescription: null,
          targetDate: null,
          timeWindowStart: null,
          timeWindowEnd: null,
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.tasks.length, 2);
    assert.equal(result.data.tasks[0]?.clientName, "Marcelo da Núcleo");
    assert.equal(result.data.tasks[1]?.type, "ENTREGA");
  });

  it("rejeita lote vazio, tipo ausente e horário fora de HH:mm", () => {
    assert.equal(parseLogisticsIntake({ tasks: [] }).ok, false);
    assert.equal(
      parseLogisticsIntake({
        tasks: [
          {
            clientName: "Núcleo",
            workDescription: null,
            targetDate: null,
            timeWindowStart: null,
            timeWindowEnd: null,
          },
        ],
      }).ok,
      false,
    );
    const badTime = parseLogisticsIntake({
      tasks: [
        {
          type: "ENTREGA",
          clientName: "Núcleo",
          workDescription: null,
          targetDate: "2026-10-24",
          timeWindowStart: "18:00",
          timeWindowEnd: "25:00",
        },
      ],
    });
    assert.equal(badTime.ok, false);
    const invertedWindow = parseLogisticsIntake({
      tasks: [
        {
          type: "COLETA",
          clientName: "Núcleo",
          workDescription: null,
          targetDate: "2026-10-24",
          timeWindowStart: "17:00",
          timeWindowEnd: "14:00",
        },
      ],
    });
    assert.equal(invertedWindow.ok, false);
  });
});
