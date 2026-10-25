import type {
  FiscalCertificateStatus,
  FiscalIssuerProfile,
  FiscalIssuerStatus,
} from "@prisma/client";

export type FiscalIssuerReadiness = {
  status: FiscalIssuerStatus;
  certificateStatus: FiscalCertificateStatus;
  canEmit: boolean;
  missingSteps: string[];
  apiKeyPrefix: string | null;
  certificateValidUntil: Date | null;
  certificateDaysUntilExp: number | null;
  lastError: string | null;
  /** Consultório com conta Notaas própria (API key colada). */
  isByok: boolean;
};

/** Prefixo do `externalProjectId` para emitentes BYOK (sem projeto Org). */
export const BYOK_PROJECT_ID_PREFIX = "byok_";

export function isByokIssuer(
  issuer: Pick<FiscalIssuerProfile, "externalProjectId"> | null | undefined,
): boolean {
  return Boolean(issuer?.externalProjectId?.startsWith(BYOK_PROJECT_ID_PREFIX));
}

export function byokExternalProjectId(userId: string): string {
  return `${BYOK_PROJECT_ID_PREFIX}${userId}`;
}

export function listIssuerMissingSteps(
  issuer: Pick<
    FiscalIssuerProfile,
    | "status"
    | "certificateStatus"
    | "encryptedProjectApiKey"
    | "externalProjectId"
    | "razaoSocial"
    | "addressCidade"
    | "addressUf"
    | "addressCep"
    | "codigoMunicipio"
  > | null,
): string[] {
  const missing: string[] = [];
  if (!issuer) {
    missing.push("Ativar emitente NFS-e no perfil");
    return missing;
  }

  if (isByokIssuer(issuer)) {
    if (!issuer.encryptedProjectApiKey) missing.push("API key da conta Notaas (BYOK)");
    if (issuer.certificateStatus !== "ACTIVE") {
      missing.push("Confirmar certificado A1 ativo no painel Notaas");
    }
    return missing;
  }

  if (!issuer.razaoSocial?.trim()) missing.push("Razão social do consultório");
  if (!issuer.addressCidade?.trim() || !issuer.addressUf?.trim()) {
    missing.push("Endereço do consultório (cidade/UF)");
  }
  if (!issuer.addressCep?.trim()) missing.push("CEP do consultório");
  if (!issuer.externalProjectId) missing.push("Registo do emitente no Notaas");
  if (issuer.certificateStatus !== "ACTIVE") {
    missing.push("Certificado digital A1 (.pfx)");
  }
  if (!issuer.encryptedProjectApiKey) missing.push("Chave de emissão do projeto");
  return missing;
}

export function resolveIssuerReadiness(
  issuer: FiscalIssuerProfile | null,
): FiscalIssuerReadiness {
  const missingSteps = listIssuerMissingSteps(issuer);
  const byok = isByokIssuer(issuer);

  const canEmit = byok
    ? issuer != null &&
      issuer.status === "CERTIFICATE_ACTIVE" &&
      issuer.certificateStatus === "ACTIVE" &&
      Boolean(issuer.encryptedProjectApiKey)
    : issuer != null &&
      issuer.status === "CERTIFICATE_ACTIVE" &&
      issuer.certificateStatus === "ACTIVE" &&
      Boolean(issuer.encryptedProjectApiKey) &&
      Boolean(issuer.externalProjectId);

  return {
    status: issuer?.status ?? "PENDING_SETUP",
    certificateStatus: issuer?.certificateStatus ?? "NONE",
    canEmit,
    missingSteps,
    apiKeyPrefix: issuer?.apiKeyPrefix ?? null,
    certificateValidUntil: issuer?.certificateValidUntil ?? null,
    certificateDaysUntilExp: issuer?.certificateDaysUntilExp ?? null,
    lastError: issuer?.lastError ?? null,
    isByok: byok,
  };
}

/** Limiares de alerta de renovação do certificado A1 (dias). */
export const CERTIFICATE_WARN_DAYS = 30;
export const CERTIFICATE_URGENT_DAYS = 7;

export type CertificateExpiryAlertLevel = "ok" | "warn" | "urgent" | "expired" | "unknown";

export function resolveCertificateExpiryAlert(
  daysUntilExp: number | null | undefined,
  certificateStatus: FiscalCertificateStatus | null | undefined,
): CertificateExpiryAlertLevel {
  if (certificateStatus === "EXPIRED") return "expired";
  if (daysUntilExp == null) return certificateStatus === "ACTIVE" ? "unknown" : "unknown";
  if (daysUntilExp < 0) return "expired";
  if (daysUntilExp <= CERTIFICATE_URGENT_DAYS) return "urgent";
  if (daysUntilExp <= CERTIFICATE_WARN_DAYS) return "warn";
  return "ok";
}

export const ISSUER_STATUS_LABEL: Record<FiscalIssuerStatus, string> = {
  PENDING_SETUP: "Emitente não configurado",
  PROJECT_REGISTERED: "Aguarda certificado A1",
  CERTIFICATE_ACTIVE: "Pronto para emitir",
  ERROR: "Erro no emitente",
};

export const CERTIFICATE_STATUS_LABEL: Record<FiscalCertificateStatus, string> = {
  NONE: "Sem certificado",
  ACTIVE: "Certificado ativo",
  EXPIRED: "Certificado expirado",
  ERROR: "Erro no certificado",
};
