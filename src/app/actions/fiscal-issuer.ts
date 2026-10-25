"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, FISCAL_CERTIFICATE_UPLOAD_RATE_LIMIT } from "@/lib/rate-limit";
import {
  buildNotaasProjectPayload,
  ALLOWED_CERTIFICATE_EXTENSIONS,
  MAX_CERTIFICATE_BYTES,
} from "@/lib/fiscal/notaas-regime";
import {
  createNotaasProject,
  createNotaasProjectApiKey,
  getNotaasProject,
  isNotaasOrgConfigured,
  mapCertificateUploadToStatus,
  patchNotaasProject,
  resolveIssuerStatusFromNotaas,
  uploadNotaasProjectCertificate,
} from "@/lib/fiscal/providers/notaas-org";
import { isNfsePublicEnabled } from "@/lib/fiscal/nfse-feature-flags";
import {
  encryptFiscalSecret,
  maskApiKeyPrefix,
} from "@/lib/fiscal/secrets-crypto";
import {
  resolveIssuerReadiness,
  type FiscalIssuerReadiness,
  ISSUER_STATUS_LABEL,
  CERTIFICATE_STATUS_LABEL,
  byokExternalProjectId,
  isByokIssuer,
  resolveCertificateExpiryAlert,
  type CertificateExpiryAlertLevel,
} from "@/lib/fiscal/issuer-readiness";
import { fiscalIssuerCertificateSchema } from "@/lib/fiscal/validation";
import { requireFinanceAdmin } from "@/lib/finance/finance-rbac";
import { z } from "zod";
import { sanitizeText } from "@/lib/sanitize";

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

async function requireFiscalUser(): Promise<ActionResult<{ userId: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  return { success: true, data: { userId: admin.userId } };
}

export type FiscalIssuerStatusPayload = FiscalIssuerReadiness & {
  orgApiEnabled: boolean;
  statusLabel: string;
  certificateLabel: string;
  certificateAlert: CertificateExpiryAlertLevel;
};

export async function getMyFiscalIssuerStatus(): Promise<
  ActionResult<FiscalIssuerStatusPayload>
> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const issuer = await prisma.fiscalIssuerProfile.findUnique({
    where: { userId },
  });
  const readiness = resolveIssuerReadiness(issuer);

  return {
    success: true,
    data: {
      ...readiness,
      orgApiEnabled: isNotaasOrgConfigured(),
      statusLabel: ISSUER_STATUS_LABEL[readiness.status],
      certificateLabel: CERTIFICATE_STATUS_LABEL[readiness.certificateStatus],
      certificateAlert: resolveCertificateExpiryAlert(
        readiness.certificateDaysUntilExp,
        readiness.certificateStatus,
      ),
    },
  };
}

/**
 * Cria ou sincroniza o projeto emitente no Notaas (Org API).
 * Chamado após guardar perfil fiscal PJ com endereço.
 */
export async function syncMyFiscalIssuerWithNotaas(): Promise<
  ActionResult<{ projectId: string; status: string }>
> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  if (!isNotaasOrgConfigured() || !isNfsePublicEnabled()) {
    return {
      success: false,
      error: "Função será ativada em breve.",
    };
  }

  const existingIssuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  if (isByokIssuer(existingIssuer)) {
    return {
      success: false,
      error: "Emitente em modo BYOK. Remova a API key própria antes de registar via plataforma.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      phone: true,
      fiscalRegime: true,
      professionalCnpj: true,
      nfseServiceCode: true,
      fiscalIssuerProfile: true,
    },
  });
  if (!user?.professionalCnpj) {
    return { success: false, error: "Informe o CNPJ do consultório no perfil." };
  }

  const issuer = user.fiscalIssuerProfile;
  if (!issuer?.razaoSocial) {
    return {
      success: false,
      error: "Complete razão social e endereço do consultório no perfil.",
    };
  }

  let projectId = issuer.externalProjectId;
  let projectPayload;
  try {
    projectPayload = buildNotaasProjectPayload({
      cnpj: user.professionalCnpj,
      razaoSocial: issuer.razaoSocial,
      fiscalRegime: user.fiscalRegime,
      inscricaoMunicipal: issuer.inscricaoMunicipal,
      codigoMunicipio: issuer.codigoMunicipio,
      nfseServiceCode: user.nfseServiceCode,
      email: user.email,
      phone: user.phone,
      addressLogradouro: issuer.addressLogradouro,
      addressNumero: issuer.addressNumero,
      addressBairro: issuer.addressBairro,
      addressCidade: issuer.addressCidade,
      addressUf: issuer.addressUf,
      addressCep: issuer.addressCep,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Dados do emitente inválidos.",
    };
  }

  try {
    if (projectId) {
      await patchNotaasProject(projectId, projectPayload);
    } else {
      let created;
      try {
        created = await createNotaasProject(projectPayload);
        projectId = created.id;
      } catch (err) {
        const conflict = err as Error & { existingProjectId?: string };
        if (conflict.existingProjectId) {
          projectId = conflict.existingProjectId;
          await patchNotaasProject(projectId, projectPayload);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    await prisma.fiscalIssuerProfile.upsert({
      where: { userId },
      create: {
        userId,
        lastError: err instanceof Error ? err.message : "Erro ao registar emitente.",
        status: "ERROR",
      },
      update: {
        lastError: err instanceof Error ? err.message : "Erro ao registar emitente.",
        status: "ERROR",
      },
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Falha ao registar emitente no Notaas.",
    };
  }

  const profile = await prisma.fiscalIssuerProfile.upsert({
    where: { userId },
    create: {
      userId,
      externalProjectId: projectId,
      razaoSocial: issuer.razaoSocial,
      inscricaoMunicipal: issuer.inscricaoMunicipal,
      codigoMunicipio: issuer.codigoMunicipio,
      addressLogradouro: issuer.addressLogradouro,
      addressNumero: issuer.addressNumero,
      addressBairro: issuer.addressBairro,
      addressCidade: issuer.addressCidade,
      addressUf: issuer.addressUf,
      addressCep: issuer.addressCep,
      status: "PROJECT_REGISTERED",
      registeredAt: new Date(),
      lastError: null,
    },
    update: {
      externalProjectId: projectId,
      status: resolveIssuerStatusFromNotaas({
        hasProject: true,
        certificateStatus: issuer.certificateStatus,
        hasApiKey: Boolean(issuer.encryptedProjectApiKey),
      }),
      registeredAt: issuer.registeredAt ?? new Date(),
      lastError: null,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/finances");

  return {
    success: true,
    data: {
      projectId: projectId!,
      status: profile.status,
    },
  };
}

/**
 * Upload de certificado A1 — enviado diretamente ao Notaas; o ficheiro NÃO é persistido.
 */
export async function uploadMyFiscalIssuerCertificate(
  formData: FormData,
): Promise<ActionResult<{ status: string; validUntil: string | null }>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  if (!isNotaasOrgConfigured() || !isNfsePublicEnabled()) {
    return {
      success: false,
      error: "Função será ativada em breve.",
    };
  }

  const issuerCheck = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  if (isByokIssuer(issuerCheck)) {
    return {
      success: false,
      error: "Em modo BYOK o certificado é gerido no painel Notaas, não no Louzada Entregas.",
    };
  }

  const rl = await enforceRateLimit(
    `fiscal-cert:${userId}`,
    FISCAL_CERTIFICATE_UPLOAD_RATE_LIMIT,
  );
  if (!rl.allowed) {
    return { success: false, error: `Muitas tentativas. Tente em ${rl.resetIn}s.` };
  }

  const passwordRaw = formData.get("password");
  const parsed = fiscalIssuerCertificateSchema.safeParse({
    password: typeof passwordRaw === "string" ? passwordRaw : "",
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Senha inválida." };
  }

  const file = formData.get("certificate");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Selecione o ficheiro .pfx ou .p12." };
  }
  if (file.size > MAX_CERTIFICATE_BYTES) {
    return { success: false, error: "Certificado muito grande (máx. 50 KB)." };
  }

  const lowerName = (file.name || "").toLowerCase();
  const dot = lowerName.lastIndexOf(".");
  const ext = dot >= 0 ? lowerName.slice(dot) : "";
  if (!ALLOWED_CERTIFICATE_EXTENSIONS.has(ext)) {
    return { success: false, error: "Use certificado .pfx ou .p12." };
  }

  let issuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  if (!issuer?.externalProjectId) {
    const sync = await syncMyFiscalIssuerWithNotaas();
    if (!sync.success) return sync;
    issuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  }
  if (!issuer?.externalProjectId) {
    return { success: false, error: "Emitente não registado no Notaas." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let certResult;
  try {
    certResult = await uploadNotaasProjectCertificate(
      issuer.externalProjectId,
      buffer,
      file.name || "certificado.pfx",
      parsed.data.password,
    );
  } catch (err) {
    await prisma.fiscalIssuerProfile.update({
      where: { userId },
      data: {
        certificateStatus: "ERROR",
        status: "ERROR",
        lastError: err instanceof Error ? err.message : "Falha no upload do certificado.",
      },
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Certificado rejeitado pelo Notaas.",
    };
  }

  const certMeta = mapCertificateUploadToStatus(certResult);

  let encryptedKey = issuer.encryptedProjectApiKey;
  let apiKeyPrefix = issuer.apiKeyPrefix;
  let externalApiKeyId = issuer.externalApiKeyId;

  if (!encryptedKey) {
    try {
      const keyResult = await createNotaasProjectApiKey(
        issuer.externalProjectId,
        `aievolui-${userId.slice(0, 8)}`,
      );
      encryptedKey = encryptFiscalSecret(keyResult.key);
      apiKeyPrefix = keyResult.keyPrefix;
      externalApiKeyId = keyResult.id;
    } catch (err) {
      await prisma.fiscalIssuerProfile.update({
        where: { userId },
        data: {
          ...certMeta,
          certificateUploadedAt: new Date(),
          status: "PROJECT_REGISTERED",
          lastError:
            err instanceof Error
              ? err.message
              : "Certificado OK, mas falha ao criar API key do projeto.",
        },
      });
      return {
        success: false,
        error:
          "Certificado enviado, mas não foi possível criar a chave de emissão. Tente novamente.",
      };
    }
  }

  const status = resolveIssuerStatusFromNotaas({
    hasProject: true,
    certificateStatus: certMeta.certificateStatus,
    hasApiKey: Boolean(encryptedKey),
  });

  await prisma.fiscalIssuerProfile.update({
    where: { userId },
    data: {
      ...certMeta,
      encryptedProjectApiKey: encryptedKey,
      apiKeyPrefix,
      externalApiKeyId,
      certificateUploadedAt: new Date(),
      status,
      lastError: null,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/finances");

  return {
    success: true,
    data: {
      status,
      validUntil: certMeta.certificateValidUntil?.toISOString() ?? null,
    },
  };
}

export async function refreshMyFiscalIssuerFromNotaas(): Promise<
  ActionResult<FiscalIssuerStatusPayload>
> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const issuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  if (!issuer?.externalProjectId || !isNotaasOrgConfigured()) {
    return getMyFiscalIssuerStatus();
  }

  try {
    const remote = await getNotaasProject(issuer.externalProjectId);
    const status = resolveIssuerStatusFromNotaas({
      hasProject: true,
      certificateStatus: remote.hasCertificate ? issuer.certificateStatus : "NONE",
      hasApiKey: Boolean(issuer.encryptedProjectApiKey) || Boolean(remote.hasApiKey),
    });
    await prisma.fiscalIssuerProfile.update({
      where: { userId },
      data: { status, lastError: null },
    });
  } catch {
    // ignore refresh errors
  }

  return getMyFiscalIssuerStatus();
}

const byokApiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^ntaas_[A-Za-z0-9_-]+$/, "API key Notaas inválida (deve começar com ntaas_)."),
  /** Confirmação de que o certificado A1 está activo no painel Notaas do consultório. */
  certificateConfirmed: z.literal(true),
});

/**
 * BYOK: consultório cola a própria API key Notaas (sem projeto Org da plataforma).
 * Certificado A1 fica no painel Notaas do consultório — não é enviado ao Louzada Entregas.
 */
export async function saveMyNotaasByokApiKey(
  input: unknown,
): Promise<ActionResult<FiscalIssuerStatusPayload>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  if (!isNfsePublicEnabled()) {
    return { success: false, error: "Emissão NFS-e ainda não está disponível." };
  }

  const rl = await enforceRateLimit(`fiscal-byok:${userId}`, FISCAL_CERTIFICATE_UPLOAD_RATE_LIMIT);
  if (!rl.allowed) {
    return { success: false, error: `Limite atingido. Tente em ${rl.resetIn}s.` };
  }

  const parsed = byokApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const apiKey = sanitizeText(parsed.data.apiKey).trim();
  const prefix = maskApiKeyPrefix(apiKey);
  const encrypted = encryptFiscalSecret(apiKey);
  const externalProjectId = byokExternalProjectId(userId);

  await prisma.fiscalIssuerProfile.upsert({
    where: { userId },
    create: {
      userId,
      provider: "NOTAAS",
      status: "CERTIFICATE_ACTIVE",
      externalProjectId,
      encryptedProjectApiKey: encrypted,
      apiKeyPrefix: prefix,
      certificateStatus: "ACTIVE",
      lastError: null,
      registeredAt: new Date(),
      certificateUploadedAt: new Date(),
    },
    update: {
      status: "CERTIFICATE_ACTIVE",
      externalProjectId,
      encryptedProjectApiKey: encrypted,
      apiKeyPrefix: prefix,
      certificateStatus: "ACTIVE",
      lastError: null,
      certificateUploadedAt: new Date(),
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/finances");

  return getMyFiscalIssuerStatus();
}

/**
 * Remove configuração BYOK (volta a poder usar fluxo Org + certificado).
 */
export async function clearMyNotaasByokApiKey(): Promise<
  ActionResult<FiscalIssuerStatusPayload>
> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const issuer = await prisma.fiscalIssuerProfile.findUnique({ where: { userId } });
  if (!issuer || !isByokIssuer(issuer)) {
    return { success: false, error: "Nenhuma configuração BYOK activa." };
  }

  await prisma.fiscalIssuerProfile.update({
    where: { userId },
    data: {
      status: "PENDING_SETUP",
      externalProjectId: null,
      encryptedProjectApiKey: null,
      apiKeyPrefix: null,
      externalApiKeyId: null,
      certificateStatus: "NONE",
      certificateValidUntil: null,
      certificateDaysUntilExp: null,
      certificateSubjectCn: null,
      certificateUploadedAt: null,
      lastError: null,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/finances");

  return getMyFiscalIssuerStatus();
}

