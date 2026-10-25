import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { buildNfseEmitPayload } from "@/lib/fiscal/build-nfse-payload";
import { resolveDefaultNfseServiceCode } from "@/lib/fiscal/nfse-service-codes";
import { verifyNotaasWebhookSignature } from "@/lib/fiscal/providers/notaas";

describe("resolveDefaultNfseServiceCode", () => {
  it("usa override do perfil", () => {
    assert.equal(resolveDefaultNfseServiceCode("Medico", "04.03"), "04.03");
  });

  it("mapeia fisioterapeuta", () => {
    assert.equal(resolveDefaultNfseServiceCode("Fisioterapeuta", null), "04.04");
  });

  it("fallback 04.01 sem profissão", () => {
    assert.equal(resolveDefaultNfseServiceCode(null, null), "04.01");
  });
});

describe("buildNfseEmitPayload", () => {
  it("monta payload Notaas com valores arredondados", () => {
    const payload = buildNfseEmitPayload({
      patientName: "Maria Silva",
      patientCpf: "52998224725",
      amountCents: 150000,
      description: "Consulta fisioterapia",
      profession: "Fisioterapeuta",
      nfseServiceCode: null,
      nfseIssAliquotaPercent: 2.5,
    });

    assert.equal(payload.tomador.nome, "Maria Silva");
    assert.equal(payload.tomador.cpf, "52998224725");
    assert.equal(payload.servico.codigo, "04.04");
    assert.equal(payload.servico.descricao, "Consulta fisioterapia");
    assert.equal(payload.valores.total, 1500);
    assert.equal(payload.valores.aliquotaIss, 2.5);
  });

  it("usa alíquota default quando null", () => {
    const payload = buildNfseEmitPayload({
      patientName: "João",
      patientCpf: "52998224725",
      amountCents: 10000,
      description: null,
      profession: "Medico",
      nfseServiceCode: "04.01",
      nfseIssAliquotaPercent: null,
    });

    assert.equal(payload.valores.aliquotaIss, 2);
    assert.equal(payload.servico.descricao, "Serviços de saúde");
  });
});

describe("verifyNotaasWebhookSignature", () => {
  it("valida HMAC sha256", () => {
    const secret = "test-webhook-secret";
    const body = JSON.stringify({ event: "nfse.issued", data: { invoiceId: "inv_1" } });
    const sig =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

    const prev = process.env.NOTAAS_WEBHOOK_SECRET;
    process.env.NOTAAS_WEBHOOK_SECRET = secret;
    try {
      assert.equal(verifyNotaasWebhookSignature(body, sig), true);
      assert.equal(verifyNotaasWebhookSignature(body, "sha256=deadbeef"), false);
    } finally {
      if (prev === undefined) delete process.env.NOTAAS_WEBHOOK_SECRET;
      else process.env.NOTAAS_WEBHOOK_SECRET = prev;
    }
  });

  it("rejeita sem secret configurado", () => {
    const prev = process.env.NOTAAS_WEBHOOK_SECRET;
    delete process.env.NOTAAS_WEBHOOK_SECRET;
    try {
      assert.equal(verifyNotaasWebhookSignature("{}", "sha256=abc"), false);
    } finally {
      if (prev !== undefined) process.env.NOTAAS_WEBHOOK_SECRET = prev;
    }
  });
});
