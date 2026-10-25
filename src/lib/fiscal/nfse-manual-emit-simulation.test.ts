/**
 * Simulação offline do fluxo manual de NFS-e (sem API Notaas).
 *
 * Cobre o processo interno:
 * 1. Gates de prontidão (PJ + emitente)
 * 2. Montagem do payload
 * 3. Emissão mock → QUEUED
 * 4. Webhook nfse.issued → ISSUED
 * 5. Cancelamento mock → CANCEL_REQUESTED
 * 6. Webhook nfse.cancelled → CANCELLED + receita READY
 * 7. Reemissão com nova Idempotency-Key
 *
 * Uso: npx tsx --test src/lib/fiscal/nfse-manual-emit-simulation.test.ts
 *  ou: npm run test:fiscal-sim
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { buildNfseEmitPayload } from "@/lib/fiscal/build-nfse-payload";
import {
  resolveTransactionFiscalStatus,
  type FiscalProfessionalContext,
  type FiscalPatientContext,
  type FiscalTransactionContext,
} from "@/lib/fiscal/transaction-fiscal-status";
import {
  resolveIssuerReadiness,
  resolveCertificateExpiryAlert,
  byokExternalProjectId,
} from "@/lib/fiscal/issuer-readiness";
import {
  notaasProvider,
  verifyNotaasWebhookSignature,
} from "@/lib/fiscal/providers/notaas";
import type {
  CancelNfseResult,
  EmitNfseResult,
  FiscalProvider,
  InvoiceStatusResult,
  NotaasEmitPayload,
} from "@/lib/fiscal/providers/types";

type DocStatus = "QUEUED" | "PROCESSING" | "ISSUED" | "ERROR" | "CANCELLED";

type SimulatedDoc = {
  transactionId: string;
  status: DocStatus;
  externalInvoiceId: string | null;
  idempotencyKey: string;
  nfseNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  webhookDeliveryIds: string[];
  fiscalExportStatus: "PENDING" | "READY" | "EXPORTED" | "NOT_APPLICABLE";
};

/** Provider in-memory — substitui a API Notaas nestes testes. */
function createMockNotaasProvider(): FiscalProvider & {
  invoices: Map<string, InvoiceStatusResult>;
  emitCalls: Array<{ payload: NotaasEmitPayload; key: string }>;
  cancelCalls: Array<{ id: string; motivo?: string }>;
} {
  const invoices = new Map<string, InvoiceStatusResult>();
  const emitCalls: Array<{ payload: NotaasEmitPayload; key: string }> = [];
  const cancelCalls: Array<{ id: string; motivo?: string }> = [];
  let seq = 0;

  return {
    name: "notaas",
    invoices,
    emitCalls,
    cancelCalls,

    async emitNfse(
      payload: NotaasEmitPayload,
      idempotencyKey: string,
    ): Promise<EmitNfseResult> {
      emitCalls.push({ payload, key: idempotencyKey });
      seq += 1;
      const externalInvoiceId = `inv_sim_${seq}_${idempotencyKey.slice(-8)}`;
      invoices.set(externalInvoiceId, { status: "queued" });
      return { externalInvoiceId, status: "queued" };
    },

    async getInvoiceStatus(externalInvoiceId: string): Promise<InvoiceStatusResult> {
      const row = invoices.get(externalInvoiceId);
      if (!row) throw new Error(`Invoice mock não encontrada: ${externalInvoiceId}`);
      return row;
    },

    async cancelNfse(
      externalInvoiceId: string,
      options?: { motivo?: string },
    ): Promise<CancelNfseResult> {
      const row = invoices.get(externalInvoiceId);
      if (!row) throw new Error(`Invoice mock não encontrada: ${externalInvoiceId}`);
      if (row.status !== "issued") {
        throw new Error("Só é possível cancelar NFS-e já emitida (autorizada).");
      }
      cancelCalls.push({ id: externalInvoiceId, motivo: options?.motivo });
      invoices.set(externalInvoiceId, { ...row, status: "processing" });
      return { accepted: true, status: "queued" };
    },

    parseWebhook: notaasProvider.parseWebhook.bind(notaasProvider),
  };
}

function applyWebhookEvent(
  doc: SimulatedDoc,
  event: NonNullable<ReturnType<typeof notaasProvider.parseWebhook>>,
): SimulatedDoc {
  if (doc.webhookDeliveryIds.includes(event.deliveryId) && event.deliveryId) {
    return doc; // idempotente
  }
  const deliveryIds = event.deliveryId
    ? [...doc.webhookDeliveryIds, event.deliveryId]
    : doc.webhookDeliveryIds;

  if (event.event === "nfse.issued") {
    return {
      ...doc,
      status: "ISSUED",
      nfseNumber: event.data.nNFSe ?? doc.nfseNumber,
      errorCode: null,
      errorMessage: null,
      webhookDeliveryIds: deliveryIds,
      fiscalExportStatus: "EXPORTED",
    };
  }
  if (event.event === "nfse.error") {
    return {
      ...doc,
      status: "ERROR",
      errorCode: event.data.errorCode ?? "UNKNOWN",
      errorMessage: event.data.errorMessage ?? "Erro",
      webhookDeliveryIds: deliveryIds,
    };
  }
  if (event.event === "nfse.cancelled") {
    return {
      ...doc,
      status: "CANCELLED",
      errorCode: null,
      errorMessage: null,
      webhookDeliveryIds: deliveryIds,
      fiscalExportStatus: "READY",
    };
  }
  return { ...doc, webhookDeliveryIds: deliveryIds };
}

function signedWebhook(
  body: object,
  secret: string,
  deliveryId: string,
): { raw: string; headers: Record<string, string | null> } {
  const raw = JSON.stringify(body);
  const sig =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return {
    raw,
    headers: {
      "x-notaas-signature": sig,
      "x-notaas-delivery": deliveryId,
    },
  };
}

const PROFESSIONAL: FiscalProfessionalContext = {
  fiscalRegime: "PJ_SIMPLES",
  professionalCpf: null,
  professionalCnpj: "11222333000181",
  carneLeaoOccupationCode: null,
  councilNumber: "12345",
  nfseServiceCode: "04.04",
  nfseIssAliquotaPercent: 2,
  profession: "Fisioterapeuta",
};

const PATIENT: FiscalPatientContext = {
  cpf: "52998224725",
  payerCpf: null,
  fiscalDataConsentAt: new Date(),
};

const TX: FiscalTransactionContext = {
  id: "tx_sim_manual_001",
  kind: "INCOME",
  patientId: "pat_sim_001",
  fiscalExportStatus: "READY",
  fiscalExportContentHash: null,
  currentContentHash: null,
};

describe("Simulação emissão manual NFS-e (offline)", () => {
  it("fluxo completo: gates → emit → issued → cancel → cancelled → reemit", async () => {
    const provider = createMockNotaasProvider();
    const secret = "sim-webhook-secret";
    const prevSecret = process.env.NOTAAS_WEBHOOK_SECRET;
    process.env.NOTAAS_WEBHOOK_SECRET = secret;

    try {
      // ── 1. Emitente pronto (Org) ──────────────────────────────────────
      const issuer = resolveIssuerReadiness({
        id: "iss1",
        userId: "u1",
        provider: "NOTAAS",
        status: "CERTIFICATE_ACTIVE",
        externalProjectId: "proj_sim",
        externalApiKeyId: "key1",
        encryptedProjectApiKey: "enc",
        apiKeyPrefix: "ntaas_sim",
        razaoSocial: "Clínica Sim Ltda",
        inscricaoMunicipal: null,
        codigoMunicipio: "3550308",
        addressLogradouro: "Rua Teste",
        addressNumero: "100",
        addressBairro: "Centro",
        addressCidade: "São Paulo",
        addressUf: "SP",
        addressCep: "01310100",
        certificateStatus: "ACTIVE",
        certificateValidUntil: new Date("2027-06-01"),
        certificateSubjectCn: "CN=CLINICA SIM",
        certificateDaysUntilExp: 200,
        lastError: null,
        registeredAt: new Date(),
        certificateUploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      assert.equal(issuer.canEmit, true);
      assert.equal(resolveCertificateExpiryAlert(200, "ACTIVE"), "ok");

      // ── 2. Gates fiscais da receita ───────────────────────────────────
      const before = resolveTransactionFiscalStatus(
        TX,
        PROFESSIONAL,
        PATIENT,
        null,
        [],
        true,
      );
      assert.equal(before.canEmitNfse, true);
      assert.equal(before.canCancelNfse, false);
      assert.equal(before.status, "READY");

      // ── 3. Payload (o que iria no POST /emitir) ───────────────────────
      const payload = buildNfseEmitPayload({
        patientName: "Maria Silva",
        patientCpf: PATIENT.cpf!,
        amountCents: 25000,
        description: "Sessão de fisioterapia — simulação manual",
        profession: PROFESSIONAL.profession,
        nfseServiceCode: PROFESSIONAL.nfseServiceCode,
        nfseIssAliquotaPercent: PROFESSIONAL.nfseIssAliquotaPercent,
      });
      assert.equal(payload.tomador.cpf, "52998224725");
      assert.equal(payload.valores.total, 250);
      assert.equal(payload.servico.codigo, "04.04");

      // ── 4. Emit (mock) → documento QUEUED ────────────────────────────
      const idempotencyKey = `tx_${TX.id}`;
      const emitResult = await provider.emitNfse(payload, idempotencyKey);
      assert.equal(emitResult.status, "queued");
      assert.ok(emitResult.externalInvoiceId.startsWith("inv_sim_"));

      let doc: SimulatedDoc = {
        transactionId: TX.id,
        status: "QUEUED",
        externalInvoiceId: emitResult.externalInvoiceId,
        idempotencyKey,
        nfseNumber: null,
        errorCode: null,
        errorMessage: null,
        webhookDeliveryIds: [],
        fiscalExportStatus: "READY",
      };

      const inFlight = resolveTransactionFiscalStatus(
        TX,
        PROFESSIONAL,
        PATIENT,
        doc.status,
        [],
        true,
      );
      assert.equal(inFlight.canEmitNfse, false);
      assert.equal(inFlight.canCancelNfse, false);

      // ── 5. Webhook nfse.issued ────────────────────────────────────────
      const issuedBody = {
        event: "nfse.issued",
        deliveryId: "del_issued_1",
        data: {
          invoiceId: doc.externalInvoiceId,
          nNFSe: "00042",
          chNFSe: "4321000000042",
        },
      };
      const issuedWh = signedWebhook(issuedBody, secret, "del_issued_1");
      const issuedEvent = provider.parseWebhook(issuedWh.raw, issuedWh.headers);
      assert.ok(issuedEvent);
      assert.equal(issuedEvent!.event, "nfse.issued");

      provider.invoices.set(doc.externalInvoiceId!, {
        status: "issued",
        nfseNumber: "00042",
        nfseAccessKey: "4321000000042",
      });
      doc = applyWebhookEvent(doc, issuedEvent!);
      assert.equal(doc.status, "ISSUED");
      assert.equal(doc.nfseNumber, "00042");
      assert.equal(doc.fiscalExportStatus, "EXPORTED");

      // entrega duplicada não altera
      const dup = applyWebhookEvent(doc, issuedEvent!);
      assert.deepEqual(dup.webhookDeliveryIds, doc.webhookDeliveryIds);

      const issuedUi = resolveTransactionFiscalStatus(
        { ...TX, fiscalExportStatus: "EXPORTED" },
        PROFESSIONAL,
        PATIENT,
        "ISSUED",
        [],
        true,
      );
      assert.equal(issuedUi.canCancelNfse, true);
      assert.equal(issuedUi.canEmitNfse, false);

      // ── 6. Cancelamento solicitado (mock POST /cancelar) ─────────────
      const cancelResult = await provider.cancelNfse(doc.externalInvoiceId!, {
        motivo: "Erro de valor na simulação",
      });
      assert.equal(cancelResult.accepted, true);
      assert.equal(provider.cancelCalls.length, 1);

      doc = {
        ...doc,
        errorCode: "CANCEL_REQUESTED",
        errorMessage: "Cancelamento solicitado: Erro de valor na simulação",
      };

      const pendingCancel = resolveTransactionFiscalStatus(
        { ...TX, fiscalExportStatus: "EXPORTED" },
        PROFESSIONAL,
        PATIENT,
        "ISSUED",
        [],
        true,
        true,
      );
      assert.equal(pendingCancel.canCancelNfse, false);
      assert.equal(pendingCancel.nfseCancelRequested, true);

      // ── 7. Webhook nfse.cancelled ─────────────────────────────────────
      const cancelledWh = signedWebhook(
        {
          event: "nfse.cancelled",
          deliveryId: "del_cancel_1",
          data: { invoiceId: doc.externalInvoiceId },
        },
        secret,
        "del_cancel_1",
      );
      const cancelledEvent = provider.parseWebhook(
        cancelledWh.raw,
        cancelledWh.headers,
      );
      assert.ok(cancelledEvent);
      provider.invoices.set(doc.externalInvoiceId!, { status: "cancelled" });
      doc = applyWebhookEvent(doc, cancelledEvent!);
      assert.equal(doc.status, "CANCELLED");
      assert.equal(doc.fiscalExportStatus, "READY");
      assert.equal(doc.errorCode, null);

      const afterCancel = resolveTransactionFiscalStatus(
        { ...TX, fiscalExportStatus: "READY" },
        PROFESSIONAL,
        PATIENT,
        "CANCELLED",
        [],
        true,
      );
      assert.equal(afterCancel.canEmitNfse, true);
      assert.equal(afterCancel.canCancelNfse, false);

      // ── 8. Reemissão com nova Idempotency-Key ─────────────────────────
      const reemitKey = `tx_${TX.id}_r${Date.now()}`;
      assert.notEqual(reemitKey, idempotencyKey);
      const reemit = await provider.emitNfse(payload, reemitKey);
      assert.notEqual(reemit.externalInvoiceId, doc.externalInvoiceId);
      assert.equal(provider.emitCalls.length, 2);
      assert.equal(provider.emitCalls[1]!.key, reemitKey);

      doc = {
        transactionId: TX.id,
        status: "QUEUED",
        externalInvoiceId: reemit.externalInvoiceId,
        idempotencyKey: reemitKey,
        nfseNumber: null,
        errorCode: null,
        errorMessage: null,
        webhookDeliveryIds: [],
        fiscalExportStatus: "READY",
      };
      assert.equal(doc.status, "QUEUED");
    } finally {
      if (prevSecret === undefined) delete process.env.NOTAAS_WEBHOOK_SECRET;
      else process.env.NOTAAS_WEBHOOK_SECRET = prevSecret;
    }
  });

  it("bloqueia emissão quando faltam dados fiscais", () => {
    const incomplete = resolveTransactionFiscalStatus(
      TX,
      { ...PROFESSIONAL, professionalCnpj: null, nfseServiceCode: null, profession: null },
      { ...PATIENT, cpf: null, fiscalDataConsentAt: null },
      null,
      ["Certificado digital A1 (.pfx)"],
      false,
    );
    assert.equal(incomplete.canEmitNfse, false);
    assert.ok(incomplete.missingFields.length > 0);
  });

  it("BYOK: emitente com chave própria passa nos gates", () => {
    const userId = "user_byok_sim";
    const readiness = resolveIssuerReadiness({
      id: "iss_byok",
      userId,
      provider: "NOTAAS",
      status: "CERTIFICATE_ACTIVE",
      externalProjectId: byokExternalProjectId(userId),
      externalApiKeyId: null,
      encryptedProjectApiKey: "enc-byok",
      apiKeyPrefix: "ntaas_byok",
      razaoSocial: null,
      inscricaoMunicipal: null,
      codigoMunicipio: null,
      addressLogradouro: null,
      addressNumero: null,
      addressBairro: null,
      addressCidade: null,
      addressUf: null,
      addressCep: null,
      certificateStatus: "ACTIVE",
      certificateValidUntil: null,
      certificateSubjectCn: null,
      certificateDaysUntilExp: null,
      lastError: null,
      registeredAt: new Date(),
      certificateUploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(readiness.isByok, true);
    assert.equal(readiness.canEmit, true);
    assert.equal(readiness.missingSteps.length, 0);
  });

  it("webhook com assinatura inválida é rejeitado", () => {
    const prev = process.env.NOTAAS_WEBHOOK_SECRET;
    process.env.NOTAAS_WEBHOOK_SECRET = "real-secret";
    try {
      const raw = JSON.stringify({
        event: "nfse.issued",
        data: { invoiceId: "inv_x" },
      });
      assert.equal(verifyNotaasWebhookSignature(raw, "sha256=deadbeef"), false);
      const parsed = notaasProvider.parseWebhook(raw, {
        "x-notaas-signature": "sha256=deadbeef",
        "x-notaas-delivery": "d1",
      });
      assert.equal(parsed, null);
    } finally {
      if (prev === undefined) delete process.env.NOTAAS_WEBHOOK_SECRET;
      else process.env.NOTAAS_WEBHOOK_SECRET = prev;
    }
  });

  it("mock cancela só invoices issued", async () => {
    const provider = createMockNotaasProvider();
    const emit = await provider.emitNfse(
      buildNfseEmitPayload({
        patientName: "X",
        patientCpf: "52998224725",
        amountCents: 1000,
        description: "t",
        profession: "Fisioterapeuta",
        nfseServiceCode: null,
        nfseIssAliquotaPercent: 2,
      }),
      "tx_early_cancel",
    );
    await assert.rejects(
      () => provider.cancelNfse(emit.externalInvoiceId),
      /já emitida|autorizada/i,
    );
  });
});
