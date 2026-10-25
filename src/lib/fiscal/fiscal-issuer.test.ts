import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listIssuerMissingSteps,
  resolveIssuerReadiness,
  resolveCertificateExpiryAlert,
  isByokIssuer,
  byokExternalProjectId,
} from "@/lib/fiscal/issuer-readiness";
import { encryptFiscalSecret, decryptFiscalSecret } from "@/lib/fiscal/secrets-crypto";
import { mapFiscalRegimeToNotaas } from "@/lib/fiscal/notaas-regime";
import { resolveTransactionFiscalStatus } from "@/lib/fiscal/transaction-fiscal-status";

describe("mapFiscalRegimeToNotaas", () => {
  it("mapeia Simples para 3", () => {
    assert.equal(mapFiscalRegimeToNotaas("PJ_SIMPLES"), "3");
  });

  it("mapeia Presumido para 1", () => {
    assert.equal(mapFiscalRegimeToNotaas("PJ_PRESUMIDO"), "1");
  });
});

describe("resolveIssuerReadiness", () => {
  it("emitente completo pode emitir", () => {
    const r = resolveIssuerReadiness({
      id: "1",
      userId: "u1",
      provider: "NOTAAS",
      status: "CERTIFICATE_ACTIVE",
      externalProjectId: "proj-1",
      externalApiKeyId: "key-1",
      encryptedProjectApiKey: "enc",
      apiKeyPrefix: "ntaas_abcd",
      razaoSocial: "Clínica X",
      inscricaoMunicipal: null,
      codigoMunicipio: "3550308",
      addressLogradouro: "Rua A",
      addressNumero: "1",
      addressBairro: "Centro",
      addressCidade: "São Paulo",
      addressUf: "SP",
      addressCep: "01310100",
      certificateStatus: "ACTIVE",
      certificateValidUntil: new Date("2027-01-01"),
      certificateSubjectCn: null,
      certificateDaysUntilExp: 200,
      lastError: null,
      registeredAt: new Date(),
      certificateUploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(r.canEmit, true);
    assert.equal(r.missingSteps.length, 0);
    assert.equal(r.isByok, false);
  });

  it("BYOK com chave pode emitir sem endereço Org", () => {
    const userId = "user-byok-1";
    const r = resolveIssuerReadiness({
      id: "1",
      userId,
      provider: "NOTAAS",
      status: "CERTIFICATE_ACTIVE",
      externalProjectId: byokExternalProjectId(userId),
      externalApiKeyId: null,
      encryptedProjectApiKey: "enc",
      apiKeyPrefix: "ntaas_abcd",
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
    assert.equal(r.isByok, true);
    assert.equal(r.canEmit, true);
  });

  it("sem certificado lista passos", () => {
    const missing = listIssuerMissingSteps({
      status: "PROJECT_REGISTERED",
      certificateStatus: "NONE",
      encryptedProjectApiKey: null,
      externalProjectId: "p1",
      razaoSocial: "Clínica",
      addressCidade: "SP",
      addressUf: "SP",
      addressCep: "01310100",
      codigoMunicipio: null,
    });
    assert.ok(missing.some((m) => m.includes("Certificado")));
  });
});

describe("isByokIssuer", () => {
  it("detecta prefixo byok_", () => {
    assert.equal(isByokIssuer({ externalProjectId: "byok_abc" }), true);
    assert.equal(isByokIssuer({ externalProjectId: "proj-1" }), false);
    assert.equal(isByokIssuer(null), false);
  });
});

describe("resolveCertificateExpiryAlert", () => {
  it("classifica limiares", () => {
    assert.equal(resolveCertificateExpiryAlert(60, "ACTIVE"), "ok");
    assert.equal(resolveCertificateExpiryAlert(30, "ACTIVE"), "warn");
    assert.equal(resolveCertificateExpiryAlert(7, "ACTIVE"), "urgent");
    assert.equal(resolveCertificateExpiryAlert(0, "ACTIVE"), "urgent");
    assert.equal(resolveCertificateExpiryAlert(-1, "ACTIVE"), "expired");
    assert.equal(resolveCertificateExpiryAlert(null, "EXPIRED"), "expired");
  });
});

describe("resolveTransactionFiscalStatus cancel", () => {
  const prof = {
    fiscalRegime: "PJ_SIMPLES" as const,
    professionalCpf: null,
    professionalCnpj: "12345678000199",
    carneLeaoOccupationCode: null,
    councilNumber: null,
    nfseServiceCode: "04.01",
    nfseIssAliquotaPercent: 2,
    profession: "Fisioterapeuta",
  };
  const patient = {
    cpf: "52998224725",
    payerCpf: null,
    fiscalDataConsentAt: new Date(),
  };
  const tx = {
    id: "tx1",
    kind: "INCOME" as const,
    patientId: "p1",
    fiscalExportStatus: "EXPORTED" as const,
    fiscalExportContentHash: null,
    currentContentHash: null,
  };

  it("permite cancelar quando ISSUED", () => {
    const r = resolveTransactionFiscalStatus(tx, prof, patient, "ISSUED", [], true, false);
    assert.equal(r.canCancelNfse, true);
    assert.equal(r.canEmitNfse, false);
  });

  it("bloqueia cancel quando já solicitado", () => {
    const r = resolveTransactionFiscalStatus(tx, prof, patient, "ISSUED", [], true, true);
    assert.equal(r.canCancelNfse, false);
    assert.equal(r.nfseCancelRequested, true);
  });

  it("permite reemitir após CANCELLED", () => {
    const r = resolveTransactionFiscalStatus(tx, prof, patient, "CANCELLED", [], true, false);
    assert.equal(r.canEmitNfse, true);
    assert.equal(r.canCancelNfse, false);
  });
});

describe("encryptFiscalSecret", () => {
  it("round-trip", () => {
    const prev = process.env.FISCAL_SECRETS_ENCRYPTION_KEY;
    process.env.FISCAL_SECRETS_ENCRYPTION_KEY = "test-key-for-fiscal-secrets-32b";
    try {
      const enc = encryptFiscalSecret("ntaas_secret_key_value");
      const dec = decryptFiscalSecret(enc);
      assert.equal(dec, "ntaas_secret_key_value");
    } finally {
      if (prev === undefined) delete process.env.FISCAL_SECRETS_ENCRYPTION_KEY;
      else process.env.FISCAL_SECRETS_ENCRYPTION_KEY = prev;
    }
  });
});
