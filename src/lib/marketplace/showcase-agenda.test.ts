import assert from "node:assert/strict";
import test from "node:test";
import { freeAgendaWindows } from "@/lib/marketplace/showcase-agenda";

const slot = {
  startAt: new Date("2026-10-20T17:00:00.000Z"),
  endAt: new Date("2026-10-20T18:00:00.000Z"),
};

test("uma marcação ocupa a agenda de um profissional sozinho", () => {
  const free = freeAgendaWindows({
    windows: [slot],
    appointments: [
      {
        id: "a1",
        startAt: slot.startAt,
        endAt: slot.endAt,
        intraUserId: null,
      },
    ],
    capacity: 1,
  });
  assert.equal(free.length, 0);
});

test("clínica com dois profissionais continua livre se só um está ocupado", () => {
  const free = freeAgendaWindows({
    windows: [slot],
    appointments: [
      {
        id: "a1",
        startAt: slot.startAt,
        endAt: slot.endAt,
        intraUserId: "membro-1",
      },
    ],
    capacity: 2,
  });
  assert.equal(free.length, 1);
});

test("horário sem marcação permanece livre", () => {
  const free = freeAgendaWindows({
    windows: [slot],
    appointments: [],
    capacity: 1,
  });
  assert.equal(free.length, 1);
});
