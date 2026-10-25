import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandPortugueseSessionDateMentions,
  inferPatientSaleAction,
  mergePerformedSessionDateGuesses,
} from "./portuguese-session-dates";

describe("expandPortugueseSessionDateMentions", () => {
  it("expande dias nomeados (08 de julho, 16 de julho)", () => {
    const dates = expandPortugueseSessionDateMentions(
      "marcar como realizadas 08 de julho, 16 de julho",
    );
    assert.equal(dates.length, 2);
    assert.match(dates[0]!, /^\d{4}-07-08$/);
    assert.match(dates[1]!, /^\d{4}-07-16$/);
  });

  it("expande lista de dias + mês", () => {
    const dates = expandPortugueseSessionDateMentions(
      "paciente realizou as sessões do plano nos dias 07, 09, 14, 16, 21, 23, 28 e 30 de julho",
    );
    assert.equal(dates.length, 8);
    assert.deepEqual(
      dates.map((d) => d.slice(5)),
      ["07-07", "07-09", "07-14", "07-16", "07-21", "07-23", "07-28", "07-30"],
    );
  });

  it("aceita dd/mm e lista sem a palavra dias", () => {
    const dates = expandPortugueseSessionDateMentions("07/07, 09/07 e 14/07");
    assert.equal(dates.length, 3);
  });
});

describe("mergePerformedSessionDateGuesses", () => {
  it("une dias nus do modelo com mês da narrativa", () => {
    const dates = mergePerformedSessionDateGuesses({
      modelDates: ["07", "09", "14", "16"],
      narrativeText: "sessões realizadas em julho",
      coerceDate: (raw) => {
        if (!raw) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        return null;
      },
    });
    assert.equal(dates.length, 4);
    assert.ok(dates.every((d) => d.includes("-07-")));
  });
});

describe("inferPatientSaleAction", () => {
  it("detecta mark_sessions_done por frase de atualização", () => {
    const action = inferPatientSaleAction({
      performedDatesCount: 2,
      narrativeText: "marcar como realizadas 08 de julho e 16 de julho",
    });
    assert.equal(action, "mark_sessions_done");
  });

  it("mantém new_sale quando há sinais de criação de plano", () => {
    const action = inferPatientSaleAction({
      performedDatesCount: 3,
      packageSessionsGuess: 4,
      agreedAmountReais: 640,
      purchaseTypeGuess: "PACKAGE",
      narrativeText: "plano de 4 sessões, já fez três",
    });
    assert.equal(action, "new_sale");
  });
});
