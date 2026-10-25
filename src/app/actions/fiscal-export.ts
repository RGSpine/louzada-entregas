"use server";

import { revalidatePath } from "next/cache";
import type { FiscalExportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, FISCAL_EXPORT_RATE_LIMIT } from "@/lib/rate-limit";
import {
  buildReceitaSaudeCsv,
  computeExportContentHash,
  type ReceitaSaudeExportRowInput,
} from "@/lib/fiscal/receita-saude-csv";
import {
  resolveTransactionFiscalStatus,
  type ResolvedFiscalStatus,
} from "@/lib/fiscal/transaction-fiscal-status";
import { buildNfseEmitPayload } from "@/lib/fiscal/build-nfse-payload";
import { isNotaasOrgConfigured, isNotaasConfigured } from "@/lib/fiscal/providers";
import { isNfsePublicEnabled, NFSE_COMING_SOON_MESSAGE, isNfseServerEmitAllowed } from "@/lib/fiscal/nfse-feature-flags";
import {
  isByokIssuer,
  listIssuerMissingSteps,
  resolveIssuerReadiness,
} from "@/lib/fiscal/issuer-readiness";
import { fiscalExportBatchSchema } from "@/lib/fiscal/validation";
import { requireFinanceAdmin } from "@/lib/finance/finance-rbac";
import { z } from "zod";

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

async function requireFiscalUser(): Promise<ActionResult<{ userId: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  return { success: true, data: { userId: admin.userId } };
}

const listFiscalTransactionsSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

export interface FiscalTransactionRow {
  id: string;
  kind: "INCOME" | "EXPENSE";
  amountCents: number;
  occurredAt: Date;
  method: string;
  description: string | null;
  patientId: string | null;
  patientName: string | null;
  fiscal: ResolvedFiscalStatus;
  fiscalExportStatus: FiscalExportStatus;
}

export async function listFiscalTransactions(
  input: unknown,
): Promise<ActionResult<FiscalTransactionRow[]>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const parsed = listFiscalTransactionsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" ") || "Intervalo de datas inválido.",
    };
  }
  const { start, end } = parsed.data;

  if (end.getTime() <= start.getTime()) {
    return { success: false, error: "Intervalo de datas inválido." };
  }

  const [professional, issuer, rows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        fiscalRegime: true,
        professionalCpf: true,
        professionalCnpj: true,
        carneLeaoOccupationCode: true,
        councilNumber: true,
        nfseServiceCode: true,
        nfseIssAliquotaPercent: true,
        profession: true,
      },
    }),
    prisma.fiscalIssuerProfile.findUnique({ where: { userId } }),
    prisma.financialTransaction.findMany({
      where: {
        professionalUserId: userId,
        occurredAt: { gte: start, lte: end },
        voidedAt: null,
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        kind: true,
        amountCents: true,
        occurredAt: true,
        method: true,
        description: true,
        patientId: true,
        fiscalExportStatus: true,
        fiscalExportContentHash: true,
        patient: {
          select: {
            name: true,
            cpf: true,
            payerCpf: true,
            fiscalDataConsentAt: true,
          },
        },
        fiscalDocument: {
          select: {
            status: true,
            nfseNumber: true,
            pdfUrl: true,
            errorCode: true,
            errorMessage: true,
          },
        },
      },
    }),
  ]);

  if (!professional) return { success: false, error: "Usuário não encontrado." };

  const orgMode = isNotaasOrgConfigured() && isNfsePublicEnabled();
  const byok = isByokIssuer(issuer);
  const issuerReadiness = resolveIssuerReadiness(issuer);
  const issuerMissing = orgMode || byok ? listIssuerMissingSteps(issuer) : [];
  const issuerCanEmit = byok
    ? issuerReadiness.canEmit
    : orgMode
      ? issuerReadiness.canEmit
      : isNotaasConfigured();

  const data: FiscalTransactionRow[] = rows.map((tx) => {
    let currentContentHash: string | null = null;
    if (
      tx.kind === "INCOME" &&
      tx.patient?.cpf &&
      tx.patient.fiscalDataConsentAt &&
      professional.professionalCpf &&
      professional.carneLeaoOccupationCode
    ) {
      const rowInput: ReceitaSaudeExportRowInput = {
        transactionId: tx.id,
        occurredAt: tx.occurredAt,
        amountCents: tx.amountCents,
        description: tx.description,
        patientCpf: tx.patient.cpf,
        patientPayerCpf: tx.patient.payerCpf,
        professionalCpf: professional.professionalCpf,
        occupationCode: professional.carneLeaoOccupationCode,
        councilNumber: professional.councilNumber,
      };
      currentContentHash = computeExportContentHash(rowInput);
    }

    const fiscal = resolveTransactionFiscalStatus(
      {
        id: tx.id,
        kind: tx.kind,
        patientId: tx.patientId,
        fiscalExportStatus: tx.fiscalExportStatus,
        fiscalExportContentHash: tx.fiscalExportContentHash,
        currentContentHash,
      },
      professional,
      tx.patient,
      tx.fiscalDocument?.status ?? null,
      issuerMissing,
      issuerCanEmit,
      tx.fiscalDocument?.errorCode === "CANCEL_REQUESTED",
    );

    return {
      id: tx.id,
      kind: tx.kind,
      amountCents: tx.amountCents,
      occurredAt: tx.occurredAt,
      method: tx.method,
      description: tx.description,
      patientId: tx.patientId,
      patientName: tx.patient?.name ?? null,
      fiscal,
      fiscalExportStatus: fiscal.status,
    };
  });

  return { success: true, data };
}

export async function exportReceitaSaudeCsv(input: unknown): Promise<
  ActionResult<{
    csvBase64: string;
    filename: string;
    warnings: string[];
    exportedCount: number;
  }>
> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const rl = await enforceRateLimit(`fiscal-export:${userId}`, FISCAL_EXPORT_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Muitas exportações. Tente em ${rl.resetIn}s.` };
  }

  const parsed = fiscalExportBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const { transactionIds } = parsed.data;

  const professional = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      fiscalRegime: true,
      professionalCpf: true,
      professionalCnpj: true,
      carneLeaoOccupationCode: true,
      councilNumber: true,
      nfseServiceCode: true,
      nfseIssAliquotaPercent: true,
      profession: true,
    },
  });
  if (!professional?.professionalCpf || !professional.carneLeaoOccupationCode) {
    return {
      success: false,
      error: "Complete os dados fiscais no perfil antes de exportar.",
    };
  }

  const rows = await prisma.financialTransaction.findMany({
    where: {
      id: { in: transactionIds },
      professionalUserId: userId,
      kind: "INCOME",
      voidedAt: null,
    },
    select: {
      id: true,
      kind: true,
      amountCents: true,
      occurredAt: true,
      description: true,
      patientId: true,
      fiscalExportStatus: true,
      fiscalExportContentHash: true,
      patient: {
        select: {
          cpf: true,
          payerCpf: true,
          fiscalDataConsentAt: true,
        },
      },
    },
  });

  if (rows.length !== transactionIds.length) {
    return { success: false, error: "Uma ou mais receitas não foram encontradas." };
  }

  const warnings: string[] = [];
  const exportRows: ReceitaSaudeExportRowInput[] = [];

  for (const tx of rows) {
    const fiscal = resolveTransactionFiscalStatus(
      {
        id: tx.id,
        kind: tx.kind,
        patientId: tx.patientId,
        fiscalExportStatus: tx.fiscalExportStatus,
        fiscalExportContentHash: tx.fiscalExportContentHash,
        currentContentHash: null,
      },
      professional,
      tx.patient,
    );

    if (!fiscal.canExportReceitaSaude) {
      return {
        success: false,
        error: `Receita incompleta para exportação: ${fiscal.missingFields.join(", ")}.`,
      };
    }

    if (!tx.patient?.cpf) {
      return { success: false, error: "CPF do paciente em falta." };
    }

    exportRows.push({
      transactionId: tx.id,
      occurredAt: tx.occurredAt,
      amountCents: tx.amountCents,
      description: tx.description,
      patientCpf: tx.patient.cpf,
      patientPayerCpf: tx.patient.payerCpf,
      professionalCpf: professional.professionalCpf,
      occupationCode: professional.carneLeaoOccupationCode,
      councilNumber: professional.councilNumber,
    });
  }

  if (!professional.councilNumber) {
    warnings.push("Número do conselho não informado — o campo ficará vazio no CSV.");
  }

  let built;
  try {
    built = buildReceitaSaudeCsv(exportRows);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erro ao gerar CSV.",
    };
  }

  const now = new Date();
  const rowHashes = exportRows.map((row) => ({
    id: row.transactionId,
    hash: computeExportContentHash(row),
  }));

  await prisma.$transaction(
    rowHashes.map(({ id, hash }) =>
      prisma.financialTransaction.update({
        where: { id },
        data: {
          fiscalExportStatus: "EXPORTED",
          fiscalExportedAt: now,
          fiscalExportContentHash: hash,
        },
      }),
    ),
  );

  const csvBase64 = Buffer.from(built.csv, "utf8").toString("base64");
  const filename = `receita-saude-${built.calendarYear}-${built.lineCount}-receitas.csv`;

  revalidatePath("/dashboard/finances");

  return {
    success: true,
    data: {
      csvBase64,
      filename,
      warnings,
      exportedCount: built.lineCount,
    },
  };
}

export interface NfsePreviewPayload {
  tomador: {
    cpf: string;
    nome: string;
  };
  servico: {
    descricao: string;
    valorReais: number;
    dataPagamento: string;
  };
  observacao: string;
}

export async function previewNfseForTransaction(
  input: unknown,
): Promise<ActionResult<NfsePreviewPayload>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const parsed = z.object({ transactionId: z.string().min(1) }).safeParse(
    typeof input === "string" ? { transactionId: input } : input,
  );
  if (!parsed.success) {
    return { success: false, error: "Identificador da receita inválido." };
  }
  const { transactionId } = parsed.data;

  if (!isNfseServerEmitAllowed()) {
    return { success: false, error: NFSE_COMING_SOON_MESSAGE };
  }

  const [tx, professional] = await Promise.all([
    prisma.financialTransaction.findFirst({
      where: { id: transactionId, professionalUserId: userId, kind: "INCOME" },
      select: {
        amountCents: true,
        occurredAt: true,
        description: true,
        patient: { select: { name: true, cpf: true, fiscalDataConsentAt: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        profession: true,
        nfseServiceCode: true,
        nfseIssAliquotaPercent: true,
      },
    }),
  ]);
  if (!tx?.patient) return { success: false, error: "Receita ou paciente não encontrado." };
  if (!professional) return { success: false, error: "Usuário não encontrado." };

  let payloadPreview: ReturnType<typeof buildNfseEmitPayload> | null = null;
  if (tx.patient.cpf) {
    try {
      payloadPreview = buildNfseEmitPayload({
        patientName: tx.patient.name,
        patientCpf: tx.patient.cpf,
        amountCents: tx.amountCents,
        description: tx.description,
        profession: professional.profession,
        nfseServiceCode: professional.nfseServiceCode,
        nfseIssAliquotaPercent: professional.nfseIssAliquotaPercent,
      });
    } catch {
      payloadPreview = null;
    }
  }

  return {
    success: true,
    data: {
      tomador: {
        cpf: tx.patient.cpf ?? "(informar CPF na ficha)",
        nome: tx.patient.name,
      },
      servico: {
        descricao: payloadPreview?.servico.descricao ?? tx.description ?? "Serviços de saúde",
        valorReais: tx.amountCents / 100,
        dataPagamento: tx.occurredAt.toISOString().slice(0, 10),
      },
      observacao: payloadPreview
        ? `Código serviço: ${payloadPreview.servico.codigo} · ISS ${payloadPreview.valores.aliquotaIss}%`
        : "Complete CPF do paciente e dados NFS-e no perfil para pré-visualização completa.",
    },
  };
}
