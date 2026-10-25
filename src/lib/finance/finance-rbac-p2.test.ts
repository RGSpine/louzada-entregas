import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFinanceAccessRole,
  memberMayConfirmFinanceIntent,
} from "@/lib/finance/finance-access-role";
import {
  createPurchaseSchema,
  evolutionBlocksStandalonePurchase,
  originAppointmentBlocksNewPurchase,
  P2_GATE_MESSAGES,
} from "@/lib/finance/purchase-schema";
import {
  buildFinanceDeepLink,
  parseFinanceDeepLink,
  buildAgendaWeekFinanceLink,
} from "@/lib/finance/finance-deep-link";

describe("resolveFinanceAccessRole", () => {
  it("plano individual → ADMIN", () => {
    assert.equal(
      resolveFinanceAccessRole({
        isClinica: false,
        requiresProfileSelection: false,
        activeIntraUser: null,
      }),
      "ADMIN",
    );
  });

  it("clínica sem perfil → DENIED", () => {
    assert.equal(
      resolveFinanceAccessRole({
        isClinica: true,
        requiresProfileSelection: true,
        activeIntraUser: null,
      }),
      "DENIED",
    );
    assert.equal(resolveFinanceAccessRole(null), "DENIED");
  });

  it("qualquer operador da conta vê o caixa inteiro", () => {
    assert.equal(
      resolveFinanceAccessRole({
        isClinica: true,
        requiresProfileSelection: false,
        activeIntraUser: { role: "MEMBER" },
      }),
      "ADMIN",
    );
    assert.equal(
      resolveFinanceAccessRole({
        isClinica: true,
        requiresProfileSelection: false,
        activeIntraUser: { role: "ADMIN" },
      }),
      "ADMIN",
    );
  });

  it("MEMBER só confirma income", () => {
    assert.equal(memberMayConfirmFinanceIntent("income"), true);
    assert.equal(memberMayConfirmFinanceIntent("register_income"), true);
    assert.equal(memberMayConfirmFinanceIntent("patient_sale"), false);
    assert.equal(memberMayConfirmFinanceIntent("expense"), false);
  });
});

describe("P2 gate — createPurchaseSchema", () => {
  const base = {
    patientId: "p1",
    professionalServiceId: "svc1",
    type: "SINGLE" as const,
    agreedPriceCents: 10000,
  };

  it("rejeita consumeFirstSessionAt sem evolutionId nem originAppointmentId", () => {
    const r = createPurchaseSchema.safeParse({
      ...base,
      consumeFirstSessionAt: new Date(),
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(
        r.error.issues.some((i) => i.message.includes(P2_GATE_MESSAGES.consumeRequiresLink) ||
          i.message.includes("evolutionId") ||
          i.message.includes("marcação")),
      );
    }
  });

  it("aceita consumeFirstSessionAt com evolutionId", () => {
    const r = createPurchaseSchema.safeParse({
      ...base,
      consumeFirstSessionAt: new Date(),
      evolutionId: "evo_1",
    });
    assert.equal(r.success, true);
  });

  it("aceita consumeFirstSessionAt com originAppointmentId", () => {
    const r = createPurchaseSchema.safeParse({
      ...base,
      consumeFirstSessionAt: new Date(),
      originAppointmentId: "apt_1",
    });
    assert.equal(r.success, true);
  });

  it("aceita preConsumedSessions sem evolutionId (baixa histórica do áudio)", () => {
    const r = createPurchaseSchema.safeParse({
      ...base,
      type: "PACKAGE",
      sessionCountTotal: 4,
      preConsumedSessions: [
        { consumedAt: new Date("2026-07-21T12:00:00") },
        { consumedAt: new Date("2026-08-08T12:00:00") },
        { consumedAt: new Date("2026-08-16T12:00:00") },
      ],
    });
    assert.equal(r.success, true);
  });

  it("rejeita preConsumedSessions além do total do pacote", () => {
    const r = createPurchaseSchema.safeParse({
      ...base,
      type: "PACKAGE",
      sessionCountTotal: 2,
      preConsumedSessions: [
        { consumedAt: new Date("2026-07-21T12:00:00") },
        { consumedAt: new Date("2026-08-08T12:00:00") },
        { consumedAt: new Date("2026-08-16T12:00:00") },
      ],
    });
    assert.equal(r.success, false);
  });

  it("rejeita consumeFirstSessionAt no futuro distante", () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const r = createPurchaseSchema.safeParse({
      ...base,
      consumeFirstSessionAt: future,
      evolutionId: "evo_1",
    });
    assert.equal(r.success, false);
  });
});

describe("P2 gate — predicados", () => {
  it("evolução com appointmentId bloqueia standalone", () => {
    assert.equal(evolutionBlocksStandalonePurchase({ appointmentId: "a1" }), true);
    assert.equal(evolutionBlocksStandalonePurchase({ appointmentId: null }), false);
  });

  it("marcação com INCOME bloqueia nova venda", () => {
    const r = originAppointmentBlocksNewPurchase({
      patientServiceSessionId: null,
      originatedPurchase: null,
      financialTransaction: { id: "tx1", kind: "INCOME" },
    });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, P2_GATE_MESSAGES.appointmentHasIncome);
  });

  it("INCOME estornada não bloqueia nova venda na marcação", () => {
    const r = originAppointmentBlocksNewPurchase({
      patientServiceSessionId: null,
      originatedPurchase: null,
      financialTransaction: {
        id: "tx1",
        kind: "INCOME",
        voidedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    assert.equal(r.blocked, false);
  });

  it("replay idempotente permite", () => {
    const r = originAppointmentBlocksNewPurchase(
      {
        patientServiceSessionId: null,
        originatedPurchase: { id: "pur1", idempotencyKey: "idem-abc" },
        financialTransaction: null,
      },
      "idem-abc",
    );
    assert.equal(r.blocked, false);
  });

  it("segunda venda na mesma marcação bloqueia", () => {
    const r = originAppointmentBlocksNewPurchase({
      patientServiceSessionId: null,
      originatedPurchase: { id: "pur1", idempotencyKey: "other" },
      financialTransaction: null,
    });
    assert.equal(r.blocked, true);
  });
});

describe("finance deep-link", () => {
  it("monta link da semana da agenda", () => {
    const href = buildAgendaWeekFinanceLink("2026-07-27");
    assert.ok(href.includes("tab=analisar"));
    assert.ok(href.includes("preset=WEEK"));
    assert.ok(href.includes("anchor=2026-07-27"));
  });

  it("parse round-trip collect → analisar", () => {
    const href = buildFinanceDeepLink({
      tab: "analisar",
      patientId: "pat_1",
      purchaseId: "pur_1",
      action: "collect",
    });
    const parsed = parseFinanceDeepLink(href.split("?")[1]!);
    assert.equal(parsed.tab, "analisar");
    assert.equal(parsed.patientId, "pat_1");
    assert.equal(parsed.purchaseId, "pur_1");
    assert.equal(parsed.action, "collect");
  });
});
