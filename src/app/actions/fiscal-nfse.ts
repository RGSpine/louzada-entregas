"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, FISCAL_EMIT_RATE_LIMIT, FISCAL_CANCEL_RATE_LIMIT } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { buildNfseEmitPayload } from "@/lib/fiscal/build-nfse-payload";
import { resolveFiscalProvider, isNotaasConfigured, isNotaasOrgConfigured } from "@/lib/fiscal/providers";
import { getIssuerApiKeyForUser } from "@/lib/fiscal/issuer-api-key";
import {
  isByokIssuer,
  listIssuerMissingSteps,
  resolveIssuerReadiness,
} from "@/lib/fiscal/issuer-readiness";
import { sanitizeText } from "@/lib/sanitize";
import {
  listMissingFiscalFields,
  type FiscalProfessionalContext,
} from "@/lib/fiscal/transaction-fiscal-status";
import {
  isNfsePublicEnabled,
  isNfseServerEmitAllowed,
  isNfseLegacyDevEnabled,
  isNfseEligibleStoredPlan,
  shouldShowNfseComingSoon,
  NFSE_COMING_SOON_MESSAGE,
  isNfseOrgTokenConfigured,
} from "@/lib/fiscal/nfse-feature-flags";
import { z } from "zod";
import { requireFinanceAdmin } from "@/lib/finance/finance-rbac";

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

async function requireFiscalUser(): Promise<ActionResult<{ userId: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  return { success: true, data: { userId: admin.userId } };
}

const emitSchema = z.object({
  transactionId: z.string().min(1),
});

export async function emitNfseForTransaction(
  input: unknown,
): Promise<ActionResult<{ documentId: string; externalInvoiceId: string }>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  if (!isNfseServerEmitAllowed()) {
    return { success: false, error: NFSE_COMING_SOON_MESSAGE };
  }

  const parsed = emitSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos." };
  }

  const provider = resolveFiscalProvider();
  if (!provider) {
    return {
      success: false,
      error: isNotaasConfigured()
        ? "Provedor fiscal indisponível."
        : "Emissão NFS-e não configurada no servidor (NOTAAS_API_KEY).",
    };
  }

  const rl = await enforceRateLimit(`fiscal-emit:${userId}`, FISCAL_EMIT_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Limite de emissões. Tente em ${rl.resetIn}s.` };
  }

  const { transactionId } = parsed.data;

  const existing = await prisma.fiscalDocument.findUnique({
    where: { transactionId },
    select: { id: true, status: true, externalInvoiceId: true, professionalUserId: true },
  });
  if (existing) {
    if (existing.professionalUserId !== userId) {
      return { success: false, error: "Receita não encontrada." };
    }
    if (existing.status === "ISSUED" && existing.externalInvoiceId) {
      return {
        success: false,
        error: "NFS-e já emitida para esta receita. Cancele-a antes de emitir outra.",
      };
    }
    if (existing.status === "QUEUED" || existing.status === "PROCESSING") {
      return {
        success: false,
        error: "Emissão já em andamento. Aguarde o webhook ou consulte o status.",
      };
    }
  }

  const tx = await prisma.financialTransaction.findFirst({
    where: {
      id: transactionId,
      professionalUserId: userId,
      kind: "INCOME",
      voidedAt: null,
    },
    select: {
      id: true,
      amountCents: true,
      description: true,
      patientId: true,
      patient: {
        select: {
          name: true,
          cpf: true,
          payerCpf: true,
          fiscalDataConsentAt: true,
        },
      },
    },
  });
  if (!tx?.patient) {
    return { success: false, error: "Receita ou paciente não encontrado." };
  }

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
  if (!professional) return { success: false, error: "Usuário não encontrado." };

  const profCtx: FiscalProfessionalContext = {
    ...professional,
    profession: professional.profession,
  };

  const missing = listMissingFiscalFields(profCtx, tx.patient, true);
  if (missing.length > 0) {
    return {
      success: false,
      error: `Complete os dados fiscais: ${missing.join(", ")}.`,
    };
  }

  const issuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  const issuerReadiness = resolveIssuerReadiness(issuer);
  const orgMode = isNotaasOrgConfigured() && isNfsePublicEnabled();
  const byok = isByokIssuer(issuer);

  if (orgMode && !byok) {
    const issuerMissing = listIssuerMissingSteps(issuer);
    if (issuerMissing.length > 0) {
      return {
        success: false,
        error: `Configure o emitente NFS-e: ${issuerMissing.join(", ")}.`,
      };
    }
    if (!issuerReadiness.canEmit) {
      return {
        success: false,
        error: "Emitente NFS-e ainda não está pronto. Envie o certificado A1 no perfil.",
      };
    }
  }

  if (byok && !issuerReadiness.canEmit) {
    return {
      success: false,
      error: "Conta Notaas própria (BYOK) incompleta. Guarde a API key no perfil fiscal.",
    };
  }

  const projectApiKey =
    orgMode || byok ? await getIssuerApiKeyForUser(userId) : null;
  if ((orgMode || byok) && !projectApiKey) {
    return {
      success: false,
      error: byok
        ? "API key Notaas indisponível. Reconfigure BYOK no perfil."
        : "Chave de emissão do consultório indisponível. Reenvie o certificado no perfil.",
    };
  }

  if (!tx.patient.cpf) {
    return { success: false, error: "CPF do paciente em falta na ficha." };
  }

  let payload;
  try {
    payload = buildNfseEmitPayload({
      patientName: tx.patient.name,
      patientCpf: tx.patient.cpf,
      amountCents: tx.amountCents,
      description: tx.description,
      profession: professional.profession,
      nfseServiceCode: professional.nfseServiceCode,
      nfseIssAliquotaPercent: professional.nfseIssAliquotaPercent,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erro ao montar NFS-e.",
    };
  }

  // Após CANCELLED/ERROR, nova Idempotency-Key (a Notaas reutiliza a anterior).
  const idempotencyKey =
    existing && (existing.status === "CANCELLED" || existing.status === "ERROR")
      ? `tx_${transactionId}_r${Date.now()}`
      : `tx_${transactionId}`;

  let emitResult;
  try {
    emitResult = await provider.emitNfse(payload, idempotencyKey, {
      apiKey: projectApiKey ?? undefined,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Falha ao enfileirar NFS-e.",
    };
  }

  // Revalida voidedAt após a chamada externa (fecha TOCTOU com estorno paralelo).
  try {
    const doc = await prisma.$transaction(async (db) => {
      const stillActive = await db.financialTransaction.findFirst({
        where: {
          id: transactionId,
          professionalUserId: userId,
          kind: "INCOME",
          voidedAt: null,
        },
        select: { id: true },
      });
      if (!stillActive) {
        throw new Error("VOIDED");
      }

      const created = await db.fiscalDocument.upsert({
        where: { transactionId },
        create: {
          professionalUserId: userId,
          transactionId,
          provider: "NOTAAS",
          status: emitResult.status === "processing" ? "PROCESSING" : "QUEUED",
          externalInvoiceId: emitResult.externalInvoiceId,
          idempotencyKey,
        },
        update: {
          status: emitResult.status === "processing" ? "PROCESSING" : "QUEUED",
          externalInvoiceId: emitResult.externalInvoiceId,
          idempotencyKey,
          errorCode: null,
          errorMessage: null,
          nfseNumber: null,
          nfseAccessKey: null,
          pdfUrl: null,
          xmlUrl: null,
          issuedAt: null,
        },
      });

      await db.financialTransaction.update({
        where: { id: transactionId },
        data: { fiscalExportStatus: "READY", fiscalExportedAt: null },
      });

      return created;
    });

    revalidatePath("/dashboard/finances");

    return {
      success: true,
      data: { documentId: doc.id, externalInvoiceId: emitResult.externalInvoiceId },
    };
  } catch (e) {
    if (e instanceof Error && e.message === "VOIDED") {
      return {
        success: false,
        error:
          "Lançamento foi estornado durante a emissão. A fila externa pode ter recebido o pedido — verifique no painel Notaas antes de reemitir.",
      };
    }
    throw e;
  }
}

const cancelSchema = z.object({
  transactionId: z.string().min(1),
  motivo: z.string().max(255).optional(),
});

/**
 * Solicita cancelamento assíncrono de NFS-e já emitida (POST Notaas /cancelar).
 * Confirmação via webhook `nfse.cancelled` ou poll `refreshNfseDocumentStatus`.
 */
export async function cancelNfseForTransaction(
  input: unknown,
): Promise<ActionResult<{ status: "queued" | "processing" }>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  if (!isNfseServerEmitAllowed()) {
    return { success: false, error: NFSE_COMING_SOON_MESSAGE };
  }

  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos." };
  }

  const provider = resolveFiscalProvider();
  if (!provider) {
    return { success: false, error: "Provedor fiscal indisponível." };
  }

  const rl = await enforceRateLimit(`fiscal-cancel:${userId}`, FISCAL_CANCEL_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Limite de cancelamentos. Tente em ${rl.resetIn}s.` };
  }

  const { transactionId } = parsed.data;
  const motivoRaw = parsed.data.motivo?.trim();
  const motivo = motivoRaw ? sanitizeText(motivoRaw).slice(0, 255) : undefined;

  const doc = await prisma.fiscalDocument.findFirst({
    where: { transactionId, professionalUserId: userId },
  });
  if (!doc?.externalInvoiceId) {
    return { success: false, error: "Documento fiscal não encontrado." };
  }
  if (doc.status === "CANCELLED") {
    return { success: false, error: "NFS-e já cancelada." };
  }
  if (doc.status !== "ISSUED") {
    return {
      success: false,
      error: "Só é possível cancelar NFS-e já emitida (autorizada).",
    };
  }
  if (doc.errorCode === "CANCEL_REQUESTED") {
    return {
      success: false,
      error: "Cancelamento já solicitado. Aguarde confirmação ou atualize o status.",
    };
  }

  const apiKey = (await getIssuerApiKeyForUser(userId)) ?? undefined;

  try {
    const result = await provider.cancelNfse(doc.externalInvoiceId, {
      apiKey,
      motivo,
    });

    // Mantém ISSUED até webhook/poll; grava pedido para a UI.
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        errorCode: "CANCEL_REQUESTED",
        errorMessage: motivo
          ? `Cancelamento solicitado: ${motivo}`
          : "Cancelamento solicitado. Aguardando confirmação.",
      },
    });

    revalidatePath("/dashboard/finances");

    return { success: true, data: { status: result.status } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Falha ao solicitar cancelamento.",
    };
  }
}

export async function refreshNfseDocumentStatus(
  input: unknown,
): Promise<ActionResult<{ status: string; nfseNumber: string | null }>> {
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

  const doc = await prisma.fiscalDocument.findFirst({
    where: { transactionId, professionalUserId: userId },
  });
  if (!doc?.externalInvoiceId) {
    return { success: false, error: "Documento fiscal não encontrado." };
  }

  const provider = resolveFiscalProvider();
  if (!provider) {
    return { success: false, error: "Provedor fiscal indisponível." };
  }

  const statusResult = await provider.getInvoiceStatus(doc.externalInvoiceId, {
    apiKey: (await getIssuerApiKeyForUser(userId)) ?? undefined,
  });

  const updates: Parameters<typeof prisma.fiscalDocument.update>[0]["data"] = {
    status:
      statusResult.status === "issued"
        ? "ISSUED"
        : statusResult.status === "error"
          ? "ERROR"
          : statusResult.status === "cancelled"
            ? "CANCELLED"
            : statusResult.status === "processing"
              ? "PROCESSING"
              : "QUEUED",
    nfseNumber: statusResult.nfseNumber ?? undefined,
    nfseAccessKey: statusResult.nfseAccessKey ?? undefined,
    errorCode: statusResult.errorCode ?? undefined,
    errorMessage: statusResult.errorMessage ?? undefined,
    pdfUrl: statusResult.pdfUrl ?? undefined,
    xmlUrl: statusResult.xmlUrl ?? undefined,
    issuedAt: statusResult.issuedAt ? new Date(statusResult.issuedAt) : undefined,
  };

  await prisma.fiscalDocument.update({ where: { id: doc.id }, data: updates });

  if (statusResult.status === "issued") {
    await prisma.financialTransaction.update({
      where: { id: transactionId },
      data: { fiscalExportStatus: "EXPORTED", fiscalExportedAt: new Date() },
    });
    // Não limpar CANCEL_REQUESTED enquanto a Notaas ainda devolve issued —
    // o cancelamento assíncrono pode estar em fila; a UI precisa manter o estado.
  }

  if (statusResult.status === "cancelled") {
    await prisma.financialTransaction.update({
      where: { id: transactionId },
      data: { fiscalExportStatus: "READY", fiscalExportedAt: null },
    });
    await prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: { errorCode: null, errorMessage: null },
    });
  }

  revalidatePath("/dashboard/finances");

  return {
    success: true,
    data: {
      status: updates.status as string,
      nfseNumber: statusResult.nfseNumber ?? null,
    },
  };
}

export async function isNfseEmissionEnabled(): Promise<boolean> {
  if (!isNotaasConfigured() && !isNotaasOrgConfigured()) return false;
  return isNfseServerEmitAllowed();
}

export type FiscalNfseClientConfig = {
  comingSoon: boolean;
  userFacingActive: boolean;
  eligiblePlan: boolean;
  message: string;
  legacyDev: boolean;
  orgTokenConfigured: boolean;
};

export async function getFiscalNfseClientConfig(): Promise<FiscalNfseClientConfig> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let storedPlan: string | null = null;
  if (user?.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { plan: true },
    });
    storedPlan = dbUser?.plan ?? null;
  }

  const eligiblePlan = isNfseEligibleStoredPlan(storedPlan);
  const comingSoon = shouldShowNfseComingSoon(storedPlan);
  const userFacingActive = eligiblePlan && isNfsePublicEnabled();

  return {
    comingSoon,
    userFacingActive,
    eligiblePlan,
    message: NFSE_COMING_SOON_MESSAGE,
    legacyDev: isNfseLegacyDevEnabled(),
    orgTokenConfigured: isNfseOrgTokenConfigured(),
  };
}
