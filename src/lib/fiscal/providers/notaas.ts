import crypto from "crypto";
import type {
  CancelNfseResult,
  EmitNfseResult,
  FiscalProvider,
  InvoiceStatusResult,
  NotaasEmitPayload,
  NotaasWebhookEvent,
} from "@/lib/fiscal/providers/types";

const DEFAULT_BASE = "https://platform.notaas.com.br/api/v1";

function getApiKey(): string | null {
  const key = process.env.NOTAAS_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function getWebhookSecret(): string | null {
  const secret = process.env.NOTAAS_WEBHOOK_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function baseUrl(): string {
  return (process.env.NOTAAS_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

async function notaasFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string; apiKey?: string } = {},
): Promise<T> {
  const apiKey = init.apiKey?.trim() || getApiKey();
  if (!apiKey) {
    throw new Error("NOTAAS_API_KEY não configurada no servidor.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const { idempotencyKey: _ik, apiKey: _ak, ...fetchInit } = init;

  const res = await fetch(`${baseUrl()}${path}`, {
    ...fetchInit,
    headers,
  });

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
    const msg =
      typeof json === "object" &&
      json !== null &&
      "message" in json &&
      typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Notaas HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json as T;
}

export function verifyNotaasWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = getWebhookSecret();
  if (!secret || !signatureHeader) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isNotaasConfigured(): boolean {
  return getApiKey() != null;
}

export const notaasProvider: FiscalProvider = {
  name: "notaas",

  async emitNfse(
    payload: NotaasEmitPayload,
    idempotencyKey: string,
    options?: { apiKey?: string },
  ): Promise<EmitNfseResult> {
    const data = await notaasFetch<{
      invoiceId?: string;
      status?: string;
    }>("/emitir", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey,
      apiKey: options?.apiKey,
    });

    if (!data.invoiceId) {
      throw new Error("Notaas não retornou invoiceId.");
    }

    return {
      externalInvoiceId: data.invoiceId,
      status: data.status === "processing" ? "processing" : "queued",
    };
  },

  async getInvoiceStatus(
    externalInvoiceId: string,
    options?: { apiKey?: string },
  ): Promise<InvoiceStatusResult> {
    const data = await notaasFetch<{
      status?: string;
      nNFSe?: string;
      chNFSe?: string;
      issuedAt?: string;
      errorCode?: string;
      errorMessage?: string;
      pdfUrl?: string;
      xmlUrl?: string;
    }>(`/invoices/${encodeURIComponent(externalInvoiceId)}/status`, {
      apiKey: options?.apiKey,
    });

    const status = (data.status ?? "queued") as InvoiceStatusResult["status"];
    return {
      status,
      nfseNumber: data.nNFSe ?? null,
      nfseAccessKey: data.chNFSe ?? null,
      issuedAt: data.issuedAt ?? null,
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage ?? null,
      pdfUrl: data.pdfUrl ?? null,
      xmlUrl: data.xmlUrl ?? null,
    };
  },

  async cancelNfse(
    externalInvoiceId: string,
    options?: { apiKey?: string; motivo?: string },
  ): Promise<CancelNfseResult> {
    const body: { invoiceId: string; motivo?: string } = {
      invoiceId: externalInvoiceId,
    };
    const motivo = options?.motivo?.trim();
    if (motivo) {
      body.motivo = motivo.slice(0, 255);
    }

    const data = await notaasFetch<{ status?: string }>("/cancelar", {
      method: "POST",
      body: JSON.stringify(body),
      apiKey: options?.apiKey,
    });

    return {
      accepted: true,
      status: data.status === "processing" ? "processing" : "queued",
    };
  },

  parseWebhook(rawBody: string, headers: Record<string, string | null>): NotaasWebhookEvent | null {
    const secret = getWebhookSecret();
    if (secret) {
      const sig = headers["x-notaas-signature"] ?? headers["X-Notaas-Signature"];
      if (!verifyNotaasWebhookSignature(rawBody, sig)) {
        return null;
      }
    }

    let parsed: {
      event?: string;
      deliveryId?: string;
      data?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return null;
    }

    const deliveryId =
      headers["x-notaas-delivery"] ??
      headers["X-Notaas-Delivery"] ??
      parsed.deliveryId ??
      "";

    const event = parsed.event;
    const data = parsed.data ?? {};
    const invoiceId = typeof data.invoiceId === "string" ? data.invoiceId : "";

    if (!event || !invoiceId) return null;

    if (event === "nfse.issued") {
      return {
        event,
        deliveryId,
        data: {
          invoiceId,
          chNFSe: typeof data.chNFSe === "string" ? data.chNFSe : undefined,
          nNFSe: typeof data.nNFSe === "string" ? data.nNFSe : undefined,
        },
      };
    }

    if (event === "nfse.error") {
      return {
        event,
        deliveryId,
        data: {
          invoiceId,
          errorCode: typeof data.errorCode === "string" ? data.errorCode : undefined,
          errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : undefined,
        },
      };
    }

    if (event === "nfse.documents_ready") {
      return {
        event,
        deliveryId,
        data: {
          invoiceId,
          pdfUrl: typeof data.pdfUrl === "string" ? data.pdfUrl : undefined,
          xmlUrl: typeof data.xmlUrl === "string" ? data.xmlUrl : undefined,
        },
      };
    }

    if (event === "nfse.cancelled") {
      return { event, deliveryId, data: { invoiceId } };
    }

    return null;
  },
};
