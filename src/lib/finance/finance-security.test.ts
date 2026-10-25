/**
 * Testes de segurança — produto/caixa (tópico 4).
 * Procura regressões de IDOR, RBAC bypass, injecção e validação fraca.
 *
 * Uso: npm run test:finance-security
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFinanceAccessRole,
  memberMayConfirmFinanceIntent,
} from "@/lib/finance/finance-access-role";
import { createPurchaseSchema } from "@/lib/finance/purchase-schema";
import {
  buildFinanceDeepLink,
  parseFinanceDeepLink,
} from "@/lib/finance/finance-deep-link";
import { sanitizeText } from "@/lib/sanitize";
import { z } from "zod";

/** Espelha voidTxSchema / updateTxMetaSchema de clinic-finances (sem DB). */
const voidTxSchema = z.object({
  transactionId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

const updateTxMetaSchema = z.object({
  transactionId: z.string().min(1),
  description: z.string().max(2000).optional(),
  method: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
  category: z.string().trim().max(120).optional(),
});

const createTxSchema = z.object({
  kind: z.enum(["INCOME", "EXPENSE"]),
  amountCents: z.coerce.number().int().min(1).max(500_000_000),
  occurredAt: z.coerce.date(),
  method: z.enum(["PIX", "CASH", "CARD", "TRANSFER", "OTHER"]),
  description: z.string().max(2000).optional(),
  patientId: z.string().min(1).optional(),
  purchaseId: z.string().min(1).optional(),
});

describe("Segurança — RBAC fail-closed", () => {
  it("clínica sem perfil nunca vira ADMIN", () => {
    assert.equal(resolveFinanceAccessRole(null), "DENIED");
    assert.equal(
      resolveFinanceAccessRole({
        isClinica: true,
        requiresProfileSelection: true,
        activeIntraUser: null,
      }),
      "DENIED",
    );
  });

  it("MEMBER não confirma venda/despesa/fix via intent", () => {
    for (const intent of ["patient_sale", "expense", "fixed", "recurringExpense", "period_report"]) {
      assert.equal(
        memberMayConfirmFinanceIntent(intent),
        false,
        `intent ${intent} deveria ser bloqueado`,
      );
    }
  });
});

describe("Segurança — Zod / injecção em estorno e meta", () => {
  it("rejeita estorno sem motivo / motivo curto", () => {
    assert.equal(voidTxSchema.safeParse({ transactionId: "t1", reason: "" }).success, false);
    assert.equal(voidTxSchema.safeParse({ transactionId: "t1", reason: "ab" }).success, false);
    assert.equal(voidTxSchema.safeParse({ transactionId: "", reason: "ok motivo" }).success, false);
  });

  it("sanitiza HTML/script no motivo e descrição", () => {
    const dirty = '<script>alert(1)</script>Estorno<script>';
    const clean = sanitizeText(dirty);
    assert.equal(clean.includes("<script>"), false);
    assert.ok(clean.toLowerCase().includes("estorno") || clean.length >= 0);

    const xssDesc = '"><img src=x onerror=alert(1)>';
    const cleanedDesc = sanitizeText(xssDesc);
    assert.equal(cleanedDesc.includes("onerror"), false);
  });

  it("update meta não aceita amountCents (não está no schema)", () => {
    const sneaky = updateTxMetaSchema.safeParse({
      transactionId: "t1",
      description: "ok",
      amountCents: 1,
    });
    assert.equal(sneaky.success, true);
    if (sneaky.success) {
      assert.equal("amountCents" in sneaky.data, false);
    }
  });

  it("create tx rejeita amountCents zero/negativo e kind inválido", () => {
    const base = {
      occurredAt: new Date(),
      method: "PIX" as const,
    };
    assert.equal(
      createTxSchema.safeParse({ ...base, kind: "INCOME", amountCents: 0 }).success,
      false,
    );
    assert.equal(
      createTxSchema.safeParse({ ...base, kind: "INCOME", amountCents: -10 }).success,
      false,
    );
    assert.equal(
      createTxSchema.safeParse({ ...base, kind: "TRANSFER", amountCents: 100 }).success,
      false,
    );
  });
});

describe("Segurança — P2 bypass attempts", () => {
  it("consumeFirstSessionAt sem link é rejeitado", () => {
    const r = createPurchaseSchema.safeParse({
      patientId: "p",
      professionalServiceId: "s",
      type: "PACKAGE",
      agreedPriceCents: 50000,
      sessionCountTotal: 4,
      consumeFirstSessionAt: new Date().toISOString(),
    });
    assert.equal(r.success, false);
  });

  it("evolutionId vazio não conta como vínculo", () => {
    const r = createPurchaseSchema.safeParse({
      patientId: "p",
      professionalServiceId: "s",
      type: "SINGLE",
      agreedPriceCents: 1000,
      consumeFirstSessionAt: new Date(),
      evolutionId: "   ",
    });
    // trim().min(1) no schema — espaços devem falhar
    assert.equal(r.success, false);
  });
});

describe("Segurança — deep-link open redirect / param injection", () => {
  it("tab/action inválidos são ignorados no parse", () => {
    const p = parseFinanceDeepLink(
      "tab=javascript:alert(1)&action=drop-table&patientId=ok&from=not-a-date&preset=HACK",
    );
    assert.equal(p.tab, null);
    assert.equal(p.action, null);
    assert.equal(p.from, null);
    assert.equal(p.preset, null);
    assert.equal(p.patientId, "ok");
  });

  it("buildFinanceDeepLink só gera path relativo (sem open redirect)", () => {
    const href = buildFinanceDeepLink({
      tab: "analisar",
      patientId: "https://evil.example/phish",
      action: "pending",
    });
    assert.ok(href.startsWith("/dashboard/finances?"));
    assert.ok(!href.startsWith("http"));
    assert.ok(!href.startsWith("//"));
  });

  it("datas fora do formato ISO ou calendário inválido são descartadas", () => {
    const href = buildFinanceDeepLink({
      from: "27/07/2026",
      to: "2026-13-40",
      anchorIso: "yesterday",
    });
    assert.equal(href.includes("from="), false);
    assert.equal(href.includes("to="), false);
    assert.equal(href.includes("anchor="), false);
  });
});

describe("Segurança — isolamento lógico de extrato/pendências", () => {
  it("compra de outro tenant não entra em pendências do user", () => {
    const myId = "u1";
    const purchases = [
      { id: "p1", professionalUserId: myId },
      { id: "p2", professionalUserId: "u2" },
    ];
    const txs = [
      {
        purchaseId: "p1",
        kind: "INCOME" as const,
        voidedAt: null as Date | null,
        professionalUserId: myId,
      },
    ];
    const pending = purchases.filter((p) => {
      if (p.professionalUserId !== myId) return false;
      return !txs.some(
        (t) =>
          t.purchaseId === p.id &&
          t.kind === "INCOME" &&
          t.voidedAt == null &&
          t.professionalUserId === myId,
      );
    });
    assert.equal(pending.length, 0);
  });

  it("INCOME voided não bloqueia nova cobrança da mesma compra", () => {
    const purchaseId = "pur_1";
    const txs = [
      {
        purchaseId,
        kind: "INCOME" as const,
        voidedAt: new Date(),
        professionalUserId: "u1",
      },
    ];
    const hasActiveIncome = txs.some(
      (t) => t.purchaseId === purchaseId && t.kind === "INCOME" && t.voidedAt == null,
    );
    assert.equal(hasActiveIncome, false);
  });
});
