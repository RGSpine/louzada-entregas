import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReceitaSaudeCsv,
  buildReceitaSaudeCsvLine,
  RECEITA_SAUDE_INCOME_CODE,
} from "@/lib/fiscal/receita-saude-csv";
import { validateCpf, normalizeTaxId } from "@/lib/fiscal/validation";
import { resolveCarneLeaoOccupationCode } from "@/lib/fiscal/carne-leao-occupation";
import {
  resolveTransactionFiscalStatus,
  listMissingFiscalFields,
} from "@/lib/fiscal/transaction-fiscal-status";

describe("validateCpf", () => {
  it("aceita CPF válido conhecido", () => {
    assert.equal(validateCpf("52998224725"), true);
  });

  it("rejeita sequência inválida", () => {
    assert.equal(validateCpf("11111111111"), false);
  });

  it("normaliza pontuação", () => {
    assert.equal(normalizeTaxId("529.982.247-25"), "52998224725");
  });
});

describe("resolveCarneLeaoOccupationCode", () => {
  it("mapeia fisioterapeuta", () => {
    assert.equal(resolveCarneLeaoOccupationCode("Fisioterapeuta", null), "231");
  });

  it("respeita override manual", () => {
    assert.equal(resolveCarneLeaoOccupationCode("Medico", "255"), "255");
  });
});

describe("buildReceitaSaudeCsvLine", () => {
  it("gera 16 campos separados por ponto e vírgula", () => {
    const line = buildReceitaSaudeCsvLine({
      transactionId: "tx1",
      occurredAt: new Date(2026, 5, 15),
      amountCents: 150000,
      description: "Consulta fisioterapia",
      patientCpf: "12345678909",
      patientPayerCpf: null,
      professionalCpf: "52998224725",
      occupationCode: "231",
      councilNumber: "123456-F",
    });

    const fields = line.split(";");
    assert.equal(fields.length, 16);
    assert.equal(fields[0], "15/06/2026");
    assert.equal(fields[1], RECEITA_SAUDE_INCOME_CODE);
    assert.equal(fields[2], "231");
    assert.equal(fields[3], "1500,00");
    assert.equal(fields[4], "");
    assert.equal(fields[6], "PF");
    assert.equal(fields[7], "12345678909");
    assert.equal(fields[8], "12345678909");
    assert.equal(fields[13], "S");
    assert.equal(fields[14], "52998224725");
    assert.equal(fields[15], "123456-F");
  });
});

describe("buildReceitaSaudeCsv", () => {
  it("exige mesmo ano-calendário", () => {
    assert.throws(
      () =>
        buildReceitaSaudeCsv([
          {
            transactionId: "a",
            occurredAt: new Date(2025, 0, 1),
            amountCents: 10000,
            description: "A",
            patientCpf: "12345678909",
            patientPayerCpf: null,
            professionalCpf: "52998224725",
            occupationCode: "231",
            councilNumber: null,
          },
          {
            transactionId: "b",
            occurredAt: new Date(2026, 0, 1),
            amountCents: 10000,
            description: "B",
            patientCpf: "12345678909",
            patientPayerCpf: null,
            professionalCpf: "52998224725",
            occupationCode: "231",
            councilNumber: null,
          },
        ]),
      /mesmo ano-calendário/,
    );
  });

  it("inclui BOM UTF-8", () => {
    const result = buildReceitaSaudeCsv([
      {
        transactionId: "a",
        occurredAt: new Date(2026, 0, 10),
        amountCents: 25000,
        description: "Sessão",
        patientCpf: "12345678909",
        patientPayerCpf: null,
        professionalCpf: "52998224725",
        occupationCode: "255",
        councilNumber: "",
      },
    ]);
    assert.ok(result.csv.startsWith("\uFEFF"));
    assert.equal(result.lineCount, 1);
    assert.equal(result.calendarYear, 2026);
  });
});

describe("resolveTransactionFiscalStatus", () => {
  const professionalPf = {
    fiscalRegime: "PF_CARNE_LEAO" as const,
    professionalCpf: "52998224725",
    professionalCnpj: null,
    carneLeaoOccupationCode: "231",
    councilNumber: "999",
    nfseServiceCode: null,
    nfseIssAliquotaPercent: null,
    profession: "Fisioterapeuta" as const,
  };

  it("despesa é NOT_APPLICABLE", () => {
    const r = resolveTransactionFiscalStatus(
      {
        id: "1",
        kind: "EXPENSE",
        patientId: null,
        fiscalExportStatus: "NOT_APPLICABLE",
        fiscalExportContentHash: null,
        currentContentHash: null,
      },
      professionalPf,
      null,
    );
    assert.equal(r.status, "NOT_APPLICABLE");
  });

  it("receita incompleta fica PENDING", () => {
    const missing = listMissingFiscalFields(professionalPf, null, false);
    assert.ok(missing.some((m) => m.includes("Paciente")));

    const r = resolveTransactionFiscalStatus(
      {
        id: "1",
        kind: "INCOME",
        patientId: null,
        fiscalExportStatus: "NOT_APPLICABLE",
        fiscalExportContentHash: null,
        currentContentHash: null,
      },
      professionalPf,
      null,
    );
    assert.equal(r.status, "PENDING");
    assert.equal(r.canExportReceitaSaude, false);
  });

  it("receita completa fica READY", () => {
    const r = resolveTransactionFiscalStatus(
      {
        id: "1",
        kind: "INCOME",
        patientId: "p1",
        fiscalExportStatus: "NOT_APPLICABLE",
        fiscalExportContentHash: null,
        currentContentHash: "abc",
      },
      professionalPf,
      {
        cpf: "12345678909",
        payerCpf: null,
        fiscalDataConsentAt: new Date(),
      },
    );
    assert.equal(r.status, "READY");
    assert.equal(r.canExportReceitaSaude, true);
  });
});
