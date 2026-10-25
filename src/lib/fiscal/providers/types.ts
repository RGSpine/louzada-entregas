export type NotaasEmitPayload = {
  tomador: {
    nome: string;
    cpf?: string;
    cnpj?: string;
    email?: string;
  };
  servico: {
    codigo: string;
    descricao: string;
  };
  valores: {
    total: number;
    aliquotaIss: number;
  };
};

export type EmitNfseResult = {
  externalInvoiceId: string;
  status: "queued" | "processing";
};

export type InvoiceStatusResult = {
  status: "queued" | "processing" | "issued" | "error" | "cancelled";
  nfseNumber?: string | null;
  nfseAccessKey?: string | null;
  issuedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
};

export type NotaasWebhookEvent =
  | {
      event: "nfse.issued";
      deliveryId: string;
      data: { invoiceId: string; chNFSe?: string; nNFSe?: string };
    }
  | {
      event: "nfse.error";
      deliveryId: string;
      data: { invoiceId: string; errorCode?: string; errorMessage?: string };
    }
  | {
      event: "nfse.documents_ready";
      deliveryId: string;
      data: {
        invoiceId: string;
        pdfUrl?: string;
        xmlUrl?: string;
      };
    }
  | {
      event: "nfse.cancelled";
      deliveryId: string;
      data: { invoiceId: string };
    };

export type EmitNfseOptions = {
  apiKey?: string;
};

export type CancelNfseResult = {
  accepted: true;
  status: "queued" | "processing";
};

export type CancelNfseOptions = {
  apiKey?: string;
  /** Motivo do cancelamento (máx. 255 chars na API Notaas). */
  motivo?: string;
};

export interface FiscalProvider {
  readonly name: "notaas" | "focus";
  emitNfse(
    payload: NotaasEmitPayload,
    idempotencyKey: string,
    options?: EmitNfseOptions,
  ): Promise<EmitNfseResult>;
  getInvoiceStatus(
    externalInvoiceId: string,
    options?: EmitNfseOptions,
  ): Promise<InvoiceStatusResult>;
  cancelNfse(
    externalInvoiceId: string,
    options?: CancelNfseOptions,
  ): Promise<CancelNfseResult>;
  parseWebhook(rawBody: string, headers: Record<string, string | null>): NotaasWebhookEvent | null;
}
