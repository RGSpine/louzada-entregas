/**
 * Simulação offline do fluxo manual — Produto / caixa (tópico 4).
 *
 * Espelha o caminho do profissional ADMIN na UI:
 * 1. RBAC abre aba analisar
 * 2. Extrato do período (ignora voided)
 * 3. Banner de pagamentos pendentes
 * 4. Estorno controlado → compra volta a pendente
 * 5. Edição de metadados (sem mudar valor)
 * 6. Deep-link Agenda semana → extrato
 * 7. MEMBER bloqueado em estorno / venda / relatório
 *
 * Uso: npm run test:finance-manual-sim
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFinanceAccessRole,
  memberMayConfirmFinanceIntent,
} from "@/lib/finance/finance-access-role";
import {
  createPurchaseSchema,
  originAppointmentBlocksNewPurchase,
  P2_GATE_MESSAGES,
} from "@/lib/finance/purchase-schema";
import {
  buildAgendaWeekFinanceLink,
  buildFinanceDeepLink,
  parseFinanceDeepLink,
} from "@/lib/finance/finance-deep-link";
import { sanitizeText } from "@/lib/sanitize";

type TxKind = "INCOME" | "EXPENSE";

type SimTx = {
  id: string;
  professionalUserId: string;
  kind: TxKind;
  amountCents: number;
  description: string | null;
  method: string;
  category: string | null;
  purchaseId: string | null;
  patientId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  nfseStatus: "NONE" | "QUEUED" | "PROCESSING" | "ISSUED" | "CANCELLED" | "ERROR";
  appointmentId: string | null;
};

type SimPurchase = {
  id: string;
  professionalUserId: string;
  patientId: string;
  patientName: string;
  serviceName: string;
  agreedPriceCents: number;
};

function canVoidTx(tx: SimTx, role: "ADMIN" | "MEMBER"): boolean {
  if (role !== "ADMIN") return false;
  if (tx.voidedAt) return false;
  if (tx.nfseStatus === "ISSUED" || tx.nfseStatus === "QUEUED" || tx.nfseStatus === "PROCESSING") {
    return false;
  }
  return true;
}

function voidTx(
  tx: SimTx,
  role: "ADMIN" | "MEMBER",
  reason: string,
): { ok: true; tx: SimTx } | { ok: false; error: string } {
  if (role !== "ADMIN") {
    return { ok: false, error: "Acesso restrito: apenas administradores" };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "Motivo inválido." };
  if (!canVoidTx(tx, role)) {
    if (tx.voidedAt) return { ok: false, error: "Lançamento já estornado." };
    return {
      ok: false,
      error: "Há NFS-e ligada a esta receita. Cancele a nota fiscal antes de estornar.",
    };
  }
  return {
    ok: true,
    tx: {
      ...tx,
      voidedAt: new Date(),
      voidReason: sanitizeText(trimmed).slice(0, 500),
      appointmentId: null,
    },
  };
}

function updateMeta(
  tx: SimTx,
  role: "ADMIN" | "MEMBER",
  patch: { description?: string; method?: string; category?: string },
): { ok: true; tx: SimTx } | { ok: false; error: string } {
  if (role !== "ADMIN") return { ok: false, error: "Acesso restrito" };
  if (tx.voidedAt) return { ok: false, error: "Lançamento não encontrado." };
  return {
    ok: true,
    tx: {
      ...tx,
      description:
        patch.description !== undefined
          ? patch.description
            ? sanitizeText(patch.description)
            : null
          : tx.description,
      method: patch.method ?? tx.method,
      category:
        patch.category !== undefined
          ? patch.category
            ? sanitizeText(patch.category)
            : null
          : tx.category,
    },
  };
}

function listActiveExtrato(txs: SimTx[], userId: string): SimTx[] {
  return txs.filter((t) => t.professionalUserId === userId && t.voidedAt == null);
}

function listPendingPurchases(
  purchases: SimPurchase[],
  txs: SimTx[],
  userId: string,
): SimPurchase[] {
  return purchases.filter((p) => {
    if (p.professionalUserId !== userId) return false;
    const hasIncome = txs.some(
      (t) =>
        t.purchaseId === p.id &&
        t.kind === "INCOME" &&
        t.voidedAt == null &&
        t.professionalUserId === userId,
    );
    return !hasIncome;
  });
}

function memberMayCreateTx(kind: TxKind, patientId: string | null): boolean {
  if (kind !== "INCOME") return false;
  return Boolean(patientId);
}

describe("Simulação manual produto/caixa (offline)", () => {
  const tenantId = "tenant_sim_1";
  const otherTenant = "tenant_other";

  it("fluxo ADMIN: extrato → pendente → estorno → reabre cobrança → deep-link", () => {
    const role = resolveFinanceAccessRole({
      isClinica: true,
      requiresProfileSelection: false,
      activeIntraUser: { role: "ADMIN" },
    });
    assert.equal(role, "ADMIN");

    let txs: SimTx[] = [
      {
        id: "tx_income_1",
        professionalUserId: tenantId,
        kind: "INCOME",
        amountCents: 15000,
        description: "Sessão avulsa",
        method: "PIX",
        category: null,
        purchaseId: "pur_1",
        patientId: "pat_1",
        voidedAt: null,
        voidReason: null,
        nfseStatus: "NONE",
        appointmentId: "appt-1",
      },
      {
        id: "tx_expense_1",
        professionalUserId: tenantId,
        kind: "EXPENSE",
        amountCents: 2000,
        description: "Material",
        method: "CASH",
        category: "materiais",
        purchaseId: null,
        patientId: null,
        voidedAt: null,
        voidReason: null,
        nfseStatus: "NONE",
        appointmentId: null,
      },
      // Cross-tenant — nunca deve aparecer
      {
        id: "tx_other",
        professionalUserId: otherTenant,
        kind: "INCOME",
        amountCents: 99999,
        description: "Leak?",
        method: "PIX",
        category: null,
        purchaseId: "pur_x",
        patientId: "pat_x",
        voidedAt: null,
        voidReason: null,
        nfseStatus: "NONE",
        appointmentId: null,
      },
    ];

    const purchases: SimPurchase[] = [
      {
        id: "pur_1",
        professionalUserId: tenantId,
        patientId: "pat_1",
        patientName: "Maria",
        serviceName: "Fisio",
        agreedPriceCents: 15000,
      },
      {
        id: "pur_2",
        professionalUserId: tenantId,
        patientId: "pat_2",
        patientName: "João",
        serviceName: "Avaliação",
        agreedPriceCents: 20000,
      },
    ];

    // Extrato activo
    let extrato = listActiveExtrato(txs, tenantId);
    assert.equal(extrato.length, 2);
    assert.ok(!extrato.some((t) => t.id === "tx_other"));

    // Pendências: pur_2 sem INCOME; pur_1 paga
    let pending = listPendingPurchases(purchases, txs, tenantId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.id, "pur_2");

    // Deep-link Agenda → semana
    const weekLink = buildAgendaWeekFinanceLink("2026-07-27");
    const parsedWeek = parseFinanceDeepLink(weekLink.split("?")[1]!);
    assert.equal(parsedWeek.tab, "analisar");
    assert.equal(parsedWeek.preset, "WEEK");
    assert.equal(parsedWeek.anchorIso, "2026-07-27");

    // Deep-link cobrança pendente (Analisar + formulário inline)
    const collectLink = buildFinanceDeepLink({
      tab: "analisar",
      patientId: "pat_2",
      purchaseId: "pur_2",
      action: "collect",
    });
    assert.ok(collectLink.includes("action=collect"));
    assert.ok(collectLink.includes("purchaseId=pur_2"));
    assert.ok(collectLink.includes("tab=analisar"));

    // Editar descrição
    const edited = updateMeta(txs[0]!, "ADMIN", {
      description: "Sessão avulsa — ajuste",
    });
    assert.equal(edited.ok, true);
    if (edited.ok) txs[0] = edited.tx;

    // Estornar INCOME → pur_1 volta a pendente; appointmentId libertado
    const voided = voidTx(txs[0]!, "ADMIN", "Lançamento duplicado");
    assert.equal(voided.ok, true);
    if (voided.ok) txs[0] = voided.tx;
    assert.equal(txs[0]!.appointmentId, null);
    assert.ok(txs[0]!.voidedAt);

    extrato = listActiveExtrato(txs, tenantId);
    assert.equal(extrato.length, 1);
    assert.equal(extrato[0]!.kind, "EXPENSE");

    pending = listPendingPurchases(purchases, txs, tenantId);
    assert.equal(pending.map((p) => p.id).sort().join(","), "pur_1,pur_2");

    // Re-cobrança após estorno
    txs.push({
      id: "tx_income_2",
      professionalUserId: tenantId,
      kind: "INCOME",
      amountCents: 15000,
      description: "Recebimento após estorno",
      method: "PIX",
      category: null,
      purchaseId: "pur_1",
      patientId: "pat_1",
      voidedAt: null,
      voidReason: null,
      nfseStatus: "NONE",
      appointmentId: null,
    });
    pending = listPendingPurchases(purchases, txs, tenantId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.id, "pur_2");
  });

  it("fluxo MEMBER: só income com paciente; bloqueia estorno e intents de venda", () => {
    const role = resolveFinanceAccessRole({
      isClinica: true,
      requiresProfileSelection: false,
      activeIntraUser: { role: "MEMBER" },
    });
    assert.equal(role, "ADMIN");
    assert.equal(memberMayCreateTx("INCOME", "pat_1"), true);
    assert.equal(memberMayCreateTx("INCOME", null), false);
    assert.equal(memberMayCreateTx("EXPENSE", "pat_1"), false);
    assert.equal(memberMayConfirmFinanceIntent("patient_sale"), false);
    assert.equal(memberMayConfirmFinanceIntent("income"), true);

    const tx: SimTx = {
      id: "tx1",
      professionalUserId: tenantId,
      kind: "INCOME",
      amountCents: 1000,
      description: null,
      method: "PIX",
      category: null,
      purchaseId: null,
      patientId: "pat_1",
      voidedAt: null,
      voidReason: null,
      nfseStatus: "NONE",
      appointmentId: "appt-member",
    };
    const v = voidTx(tx, "MEMBER", "tentativa");
    assert.equal(v.ok, false);
    const e = updateMeta(tx, "MEMBER", { description: "hack" });
    assert.equal(e.ok, false);
  });

  it("P2 na venda: baixa de sessão exige vínculo; marcação com INCOME bloqueia", () => {
    const bypass = createPurchaseSchema.safeParse({
      patientId: "p1",
      professionalServiceId: "s1",
      type: "SINGLE",
      agreedPriceCents: 10000,
      consumeFirstSessionAt: new Date(),
    });
    assert.equal(bypass.success, false);

    const ok = createPurchaseSchema.safeParse({
      patientId: "p1",
      professionalServiceId: "s1",
      type: "SINGLE",
      agreedPriceCents: 10000,
      consumeFirstSessionAt: new Date(),
      originAppointmentId: "apt_1",
    });
    assert.equal(ok.success, true);

    const blocked = originAppointmentBlocksNewPurchase({
      patientServiceSessionId: null,
      originatedPurchase: null,
      financialTransaction: { id: "tx", kind: "INCOME" },
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.reason, P2_GATE_MESSAGES.appointmentHasIncome);
  });

  it("bloqueia estorno com NFS-e emitida", () => {
    const tx: SimTx = {
      id: "tx_nfse",
      professionalUserId: tenantId,
      kind: "INCOME",
      amountCents: 5000,
      description: null,
      method: "PIX",
      category: null,
      purchaseId: "pur",
      patientId: "pat",
      voidedAt: null,
      voidReason: null,
      nfseStatus: "ISSUED",
      appointmentId: "appt-nfse",
    };
    assert.equal(canVoidTx(tx, "ADMIN"), false);
    const r = voidTx(tx, "ADMIN", "quero estornar");
    assert.equal(r.ok, false);
  });
});
