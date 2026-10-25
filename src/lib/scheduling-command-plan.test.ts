import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  expandCreateItemsMultiDay,
  normalizeRescheduleItem,
  planSchedulingCommands,
} from "./scheduling-command-plan";
import { DEFAULT_SCHEDULE_TIMEZONE } from "./schedule-temporal-parse";
import { schedulingModelOutputSchema } from "./scheduling-intent-schema";

const PLAN_NOW = DateTime.fromObject(
  { year: 2026, month: 4, day: 29, hour: 12, minute: 0 },
  { zone: DEFAULT_SCHEDULE_TIMEZONE },
).toJSDate();

function model(input: unknown) {
  return schedulingModelOutputSchema.parse(input);
}

test("criar agrupa itens completos e descarta os sem horário", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        { patientNameGuess: "Caio", dateExpression: "amanhã", timeExpression: "08:30" },
        { patientNameGuess: "Victor", dateExpression: "amanhã" },
      ],
      transcriptOrSummary: "Marque o Caio e o Victor amanhã",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "create");
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0]!.patientNameGuess, "Caio");
  assert.equal(plan.hasWork, true);
});

test("léxico corrige create do modelo quando o áudio pede desmarcar", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [{ patientNameGuess: "Ana", dateExpression: "amanhã" }],
      transcriptOrSummary: "Desmarque a Ana de amanhã",
      confidenceOverall: 0.8,
    }),
  );
  assert.equal(plan.action, "cancel");
  assert.equal(plan.cancel.length, 1);
  assert.equal(plan.create.length, 0);
});

test("léxico corrige create do modelo quando o áudio pede reagendar", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        { patientNameGuess: "Ana", dateExpression: "sexta", timeExpression: "16h" },
      ],
      transcriptOrSummary: "Reagende a Ana para sexta às 16h",
      confidenceOverall: 0.8,
    }),
  );
  assert.equal(plan.action, "reschedule");
  assert.equal(plan.reschedule.length, 1);
  // date/time viraram destino porque o modelo não preencheu newDate/newTime.
  assert.equal(plan.reschedule[0]!.newDateExpression, "sexta");
  assert.equal(plan.reschedule[0]!.newTimeExpression, "16h");
  assert.equal(plan.reschedule[0]!.dateExpression, undefined);
  assert.equal(plan.reschedule[0]!.timeExpression, undefined);
});

test("itemAction permite áudio com operações mistas", () => {
  const plan = planSchedulingCommands(
    model({
      action: "cancel",
      appointments: [
        { itemAction: "cancel", patientNameGuess: "Ana", dateExpression: "amanhã" },
        {
          itemAction: "create",
          patientNameGuess: "Bruno",
          dateExpression: "sexta",
          timeExpression: "9h",
        },
        {
          itemAction: "reschedule",
          patientNameGuess: "Carla",
          newDateExpression: "quinta",
        },
      ],
      transcriptOrSummary: "Desmarque a Ana, agende o Bruno e remarque a Carla",
      confidenceOverall: 0.85,
    }),
  );
  assert.equal(plan.cancel.length, 1);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.reschedule.length, 1);
});

test("remarcar sem destino não é executável", () => {
  const plan = planSchedulingCommands(
    model({
      action: "reschedule",
      appointments: [{ patientNameGuess: "Ana" }],
      transcriptOrSummary: "Remarque a Ana",
      confidenceOverall: 0.6,
    }),
  );
  assert.equal(plan.reschedule.length, 0);
  assert.equal(plan.hasWork, false);
});

test("desmarcar precisa apenas do nome", () => {
  const plan = planSchedulingCommands(
    model({
      action: "cancel",
      appointments: [{ patientNameGuess: "Ana" }],
      transcriptOrSummary: "Cancele a Ana",
      confidenceOverall: 0.8,
    }),
  );
  assert.equal(plan.cancel.length, 1);
  assert.equal(plan.hasWork, true);
});

test("action none ou ambiguous não gera trabalho", () => {
  for (const action of ["none", "ambiguous"]) {
    const plan = planSchedulingCommands(
      model({
        action,
        appointments: [
          { patientNameGuess: "Ana", dateExpression: "amanhã", timeExpression: "9h" },
        ],
        transcriptOrSummary: "conversa qualquer",
        confidenceOverall: 0.3,
      }),
    );
    assert.equal(plan.action, null, action);
    assert.equal(plan.hasWork, false, action);
  }
});

test("normalizeRescheduleItem preserva destino já explícito", () => {
  const item = normalizeRescheduleItem({
    patientNameGuess: "Ana",
    dateExpression: "amanhã",
    timeExpression: "14h",
    newDateExpression: "quinta",
    newTimeExpression: "16h",
  });
  assert.equal(item.dateExpression, "amanhã");
  assert.equal(item.newDateExpression, "quinta");
});

test("normalizeRescheduleItem não inventa destino quando não há nada", () => {
  const item = normalizeRescheduleItem({ patientNameGuess: "Ana" });
  assert.equal(item.newDateExpression, undefined);
  assert.equal(item.newTimeExpression, undefined);
});

test("create com terça e quinta expande em dois itens no plano", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        {
          patientNameGuess: "Eric",
          dateExpression: "terça e quinta",
          timeExpression: "19:30",
        },
      ],
      transcriptOrSummary: "Marque para terça e quinta às 19:30 Eric",
      confidenceOverall: 0.9,
    }),
    { now: PLAN_NOW, timezone: DEFAULT_SCHEDULE_TIMEZONE },
  );
  assert.equal(plan.create.length, 2);
  assert.equal(plan.create[0]!.patientNameGuess, "Eric");
  assert.equal(plan.create[0]!.timeExpression, "19:30");
  assert.deepEqual(
    plan.create.map((c) => c.dateExpression),
    ["05/05/2026", "07/05/2026"],
  );
});

test("create com terça e quinta em itens separados alinha à mesma semana", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        { patientNameGuess: "Eric", dateExpression: "terça", timeExpression: "19:30" },
        { patientNameGuess: "Eric", dateExpression: "quinta", timeExpression: "19:30" },
      ],
      transcriptOrSummary: "Marque para a terça e quinta feira às 19:30 Eric",
      confidenceOverall: 0.9,
    }),
    { now: PLAN_NOW, timezone: DEFAULT_SCHEDULE_TIMEZONE },
  );
  assert.deepEqual(
    plan.create.map((c) => c.dateExpression),
    ["05/05/2026", "07/05/2026"],
  );
});

test("rename no plano exige nome atual e novo nome", () => {
  const plan = planSchedulingCommands(
    model({
      action: "rename",
      appointments: [
        { patientNameGuess: "FECHADO", newPatientNameGuess: "Eric" },
      ],
      transcriptOrSummary: "Renomeie FECHADO para Eric",
      confidenceOverall: 0.9,
    }),
    { now: PLAN_NOW, timezone: DEFAULT_SCHEDULE_TIMEZONE },
  );
  assert.equal(plan.action, "rename");
  assert.equal(plan.rename.length, 1);
  assert.equal(plan.rename[0]!.newPatientNameGuess, "Eric");
  assert.equal(plan.hasWork, true);
});

test("create com próximas 3 segundas expande em três datas distintas", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        {
          patientNameGuess: "Marina",
          dateExpression: "próximas 3 segundas",
          timeExpression: "10h",
        },
      ],
      transcriptOrSummary: "Agende as próximas 3 segundas às 10h a Marina",
      confidenceOverall: 0.9,
    }),
    { now: PLAN_NOW, timezone: DEFAULT_SCHEDULE_TIMEZONE },
  );
  assert.deepEqual(
    plan.create.map((c) => c.dateExpression),
    ["04/05/2026", "11/05/2026", "18/05/2026"],
  );
});

test("cancel + yield no mesmo áudio vai para cancel com discountYield", () => {
  const plan = planSchedulingCommands(
    model({
      action: "cancel",
      appointments: [
        {
          itemAction: "cancel",
          patientNameGuess: "João",
          dateExpression: "hoje",
          timeExpression: "15h",
          resourceNameGuess: "sala de Pilates",
          discountYield: 30,
        },
      ],
      transcriptOrSummary:
        "Cancelar João hoje 15h na sala de Pilates e oferecer 30% de desconto.",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "cancel");
  assert.equal(plan.cancel.length, 1);
  assert.equal(plan.yield.length, 0);
  assert.equal(plan.cancel[0]!.discountYield, 30);
  assert.equal(plan.cancel[0]!.resourceNameGuess, "sala de Pilates");
  assert.equal(plan.hasWork, true);
});

test("yield sem paciente exige data, hora e desconto", () => {
  const plan = planSchedulingCommands(
    model({
      action: "yield",
      appointments: [
        {
          dateExpression: "hoje",
          timeExpression: "15h",
          discountYield: 30,
        },
      ],
      transcriptOrSummary: "Joga o horário das 15h hoje pro desconto de 30%.",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "yield");
  assert.equal(plan.yield.length, 1);
  assert.equal(plan.cancel.length, 0);
  assert.equal(plan.hasWork, true);
});

test("book no schema vira create no plano", () => {
  const plan = planSchedulingCommands(
    model({
      action: "book",
      appointments: [
        { patientNameGuess: "Ana", dateExpression: "amanhã", timeExpression: "10h" },
      ],
      transcriptOrSummary: "Marque a Ana amanhã às 10h",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "create");
  assert.equal(plan.create.length, 1);
});

test("falta justificada exige nome e causa (≥ 3 caracteres)", () => {
  const plan = planSchedulingCommands(
    model({
      action: "no_show",
      appointments: [
        {
          patientNameGuess: "Karina",
          dateExpression: "amanhã",
          noShowReason: "imprevisto familiar",
        },
        {
          patientNameGuess: "João",
          dateExpression: "hoje",
          noShowReason: "ab",
        },
      ],
      transcriptOrSummary: "A Karina não vem amanhã, imprevisto familiar",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "no_show");
  assert.equal(plan.noShow.length, 1);
  assert.equal(plan.noShow[0]!.patientNameGuess, "Karina");
  assert.equal(plan.noShow[0]!.noShowReason, "imprevisto familiar");
  assert.equal(plan.cancel.length, 0);
  assert.equal(plan.hasWork, true);
});

test("falta aceita causa em notes como fallback", () => {
  const plan = planSchedulingCommands(
    model({
      action: "no_show",
      appointments: [
        {
          patientNameGuess: "João",
          dateExpression: "hoje",
          timeExpression: "15h",
          notes: "atraso no transporte",
        },
      ],
      transcriptOrSummary: "Registre a falta do João de hoje às 15h, atraso no transporte",
      confidenceOverall: 0.9,
    }),
  );
  assert.equal(plan.action, "no_show");
  assert.equal(plan.noShow.length, 1);
  assert.equal(plan.noShow[0]!.noShowReason, "atraso no transporte");
});

test("léxico corrige create do modelo quando o áudio pede falta", () => {
  const plan = planSchedulingCommands(
    model({
      action: "create",
      appointments: [
        {
          patientNameGuess: "Karina",
          dateExpression: "amanhã",
          noShowReason: "não compareceu",
        },
      ],
      transcriptOrSummary: "A Karina não vem amanhã",
      confidenceOverall: 0.8,
    }),
  );
  assert.equal(plan.action, "no_show");
  assert.equal(plan.noShow.length, 1);
  assert.equal(plan.create.length, 0);
});

test("expandCreateItemsMultiDay é idempotente para datas simples", () => {
  const once = expandCreateItemsMultiDay(
    [{ patientNameGuess: "Ana", dateExpression: "amanhã", timeExpression: "9h" }],
    PLAN_NOW,
    DEFAULT_SCHEDULE_TIMEZONE,
  );
  const twice = expandCreateItemsMultiDay(once, PLAN_NOW, DEFAULT_SCHEDULE_TIMEZONE);
  assert.equal(twice.length, 1);
  assert.equal(twice[0]!.dateExpression, "amanhã");
});
