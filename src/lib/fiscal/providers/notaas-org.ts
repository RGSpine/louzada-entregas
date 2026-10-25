import type {
  FiscalCertificateStatus,
  FiscalIssuerStatus,
} from "@prisma/client";

const DEFAULT_BASE = "https://platform.notaas.com.br/api/v1";

export function getNotaasOrgToken(): string | null {
  const token = process.env.NOTAAS_ORG_TOKEN?.trim();
  return token && token.startsWith("ntaas_org_") ? token : null;
}

export function isNotaasOrgConfigured(): boolean {
  return getNotaasOrgToken() != null;
}

function baseUrl(): string {
  return (process.env.NOTAAS_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

async function orgFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getNotaasOrgToken();
  if (!token) {
    throw new Error("NOTAAS_ORG_TOKEN não configurada no servidor.");
  }

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (!(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  headers["x-api-key"] = token;

  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }

  if (!res.ok) {
    const conflictProjectId =
      typeof json === "object" &&
      json !== null &&
      "existingProjectId" in json &&
      typeof (json as { existingProjectId: unknown }).existingProjectId === "string"
        ? (json as { existingProjectId: string }).existingProjectId
        : undefined;

    const msg =
      typeof json === "object" &&
      json !== null &&
      "message" in json &&
      typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Notaas Org HTTP ${res.status}`;

    const err = new Error(msg) as Error & { existingProjectId?: string; status?: number };
    err.status = res.status;
    if (conflictProjectId) err.existingProjectId = conflictProjectId;
    throw err;
  }

  return json as T;
}

export type NotaasProjectResponse = {
  id: string;
  name: string;
  cnpj: string;
  razaoSocial?: string;
  active?: boolean;
  hasCertificate?: boolean;
  hasApiKey?: boolean;
};

export async function createNotaasProject(
  payload: Record<string, unknown>,
): Promise<NotaasProjectResponse> {
  return orgFetch<NotaasProjectResponse>("/org/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getNotaasProject(projectId: string): Promise<NotaasProjectResponse> {
  return orgFetch<NotaasProjectResponse>(
    `/org/projects/${encodeURIComponent(projectId)}`,
  );
}

export async function patchNotaasProject(
  projectId: string,
  payload: Record<string, unknown>,
): Promise<{ updated: boolean; id: string }> {
  return orgFetch(`/org/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type NotaasCertificateUploadResult = {
  id: string;
  fileName?: string;
  subjectCN?: string;
  validFrom?: string;
  validUntil?: string;
  daysUntilExpiration?: number;
  active?: boolean;
};

export async function uploadNotaasProjectCertificate(
  projectId: string,
  fileBuffer: Buffer,
  fileName: string,
  password: string,
): Promise<NotaasCertificateUploadResult> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: "application/x-pkcs12" });
  form.append("file", blob, fileName);
  form.append("password", password);

  return orgFetch<NotaasCertificateUploadResult>(
    `/org/projects/${encodeURIComponent(projectId)}/certificate`,
    { method: "POST", body: form },
  );
}

export type NotaasProjectApiKeyResult = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
};

export async function createNotaasProjectApiKey(
  projectId: string,
  name: string,
): Promise<NotaasProjectApiKeyResult> {
  return orgFetch<NotaasProjectApiKeyResult>(
    `/org/projects/${encodeURIComponent(projectId)}/api-keys`,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
  );
}

export function resolveIssuerStatusFromNotaas(input: {
  hasProject: boolean;
  certificateStatus: FiscalCertificateStatus;
  hasApiKey: boolean;
}): FiscalIssuerStatus {
  if (
    input.hasProject &&
    input.certificateStatus === "ACTIVE" &&
    input.hasApiKey
  ) {
    return "CERTIFICATE_ACTIVE";
  }
  if (input.hasProject) return "PROJECT_REGISTERED";
  return "PENDING_SETUP";
}

export function mapCertificateUploadToStatus(result: NotaasCertificateUploadResult): {
  certificateStatus: FiscalCertificateStatus;
  certificateValidUntil: Date | null;
  certificateSubjectCn: string | null;
  certificateDaysUntilExp: number | null;
} {
  const validUntil = result.validUntil ? new Date(result.validUntil) : null;
  const expired = validUntil != null && validUntil.getTime() < Date.now();
  return {
    certificateStatus: expired ? "EXPIRED" : "ACTIVE",
    certificateValidUntil: validUntil,
    certificateSubjectCn: result.subjectCN ?? null,
    certificateDaysUntilExp: result.daysUntilExpiration ?? null,
  };
}
