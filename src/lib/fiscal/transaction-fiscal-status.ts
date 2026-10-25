import type { FiscalExportStatus, FiscalRegime, FinancialTransactionKind } from "@prisma/client";
import { isPfCarneLeaoRegime } from "@/lib/fiscal/receita-saude-csv";

export interface FiscalProfessionalContext {
  fiscalRegime: FiscalRegime;
  professionalCpf: string | null;
  professionalCnpj: string | null;
  carneLeaoOccupationCode: string | null;
  councilNumber: string | null;
  nfseServiceCode: string | null;
  nfseIssAliquotaPercent: number | null;
  profession: string | null;
}

export interface FiscalPatientContext {
  cpf: string | null;
  payerCpf: string | null;
  fiscalDataConsentAt: Date | null;
}

export interface FiscalTransactionContext {
  id: string;
  kind: FinancialTransactionKind;
  patientId: string | null;
  fiscalExportStatus: FiscalExportStatus;
  fiscalExportContentHash: string | null;
  currentContentHash: string | null;
}

export interface ResolvedFiscalStatus {
  status: FiscalExportStatus;
  missingFields: string[];
  needsReexport: boolean;
  canExportReceitaSaude: boolean;
  canPreviewNfse: boolean;
  canEmitNfse: boolean;
  /** NFS-e emitida (ISSUED) — pode solicitar cancelamento na UI. */
  canCancelNfse: boolean;
  /** Cancelamento já solicitado; aguarda webhook/poll. */
  nfseCancelRequested: boolean;
  nfseDocumentStatus: string | null;
}

function hasPatientFiscalReady(patient: FiscalPatientContext | null | undefined): boolean {
  if (!patient?.cpf) return false;
  return patient.fiscalDataConsentAt != null;
}

export function listMissingFiscalFields(
  professional: FiscalProfessionalContext,
  patient: FiscalPatientContext | null | undefined,
  hasPatient: boolean,
  issuerMissing: string[] = [],
): string[] {
  const missing: string[] = [];

  if (professional.fiscalRegime === "UNSPECIFIED") {
    missing.push("Regime tributário no perfil");
  }

  if (isPfCarneLeaoRegime(professional.fiscalRegime)) {
    if (!professional.professionalCpf) missing.push("CPF profissional no perfil");
    if (!professional.carneLeaoOccupationCode) missing.push("Código de ocupação Carnê-Leão");
    if (!professional.councilNumber) missing.push("Número do conselho (recomendado)");
  }

  const isPj =
    professional.fiscalRegime === "PJ_SIMPLES" || professional.fiscalRegime === "PJ_PRESUMIDO";
  if (isPj) {
    if (!professional.professionalCnpj) missing.push("CNPJ do consultório no perfil");
    if (!professional.nfseServiceCode && !professional.profession) {
      missing.push("Código de serviço NFS-e no perfil");
    }
    if (professional.nfseIssAliquotaPercent == null) {
      missing.push("Alíquota ISS (%) no perfil");
    }
    missing.push(...issuerMissing);
  }

  if (!hasPatient) {
    missing.push("Paciente vinculado à receita");
  } else if (!hasPatientFiscalReady(patient)) {
    if (!patient?.cpf) missing.push("CPF do paciente na ficha");
    if (!patient?.fiscalDataConsentAt) missing.push("Consentimento fiscal do paciente");
  }

  return missing;
}

export function resolveTransactionFiscalStatus(
  tx: FiscalTransactionContext,
  professional: FiscalProfessionalContext,
  patient: FiscalPatientContext | null | undefined,
  nfseDocumentStatus: string | null = null,
  issuerMissing: string[] = [],
  issuerCanEmit = false,
  nfseCancelRequested = false,
): ResolvedFiscalStatus {
  if (tx.kind !== "INCOME") {
    return {
      status: "NOT_APPLICABLE",
      missingFields: [],
      needsReexport: false,
      canExportReceitaSaude: false,
      canPreviewNfse: false,
      canEmitNfse: false,
      canCancelNfse: false,
      nfseCancelRequested: false,
      nfseDocumentStatus: null,
    };
  }

  const isPj =
    professional.fiscalRegime === "PJ_SIMPLES" || professional.fiscalRegime === "PJ_PRESUMIDO";

  if (isPj) {
    const missingFields = listMissingFiscalFields(
      professional,
      patient,
      Boolean(tx.patientId),
      issuerMissing,
    );
    const ready = missingFields.length === 0 && Boolean(tx.patientId) && issuerCanEmit;
    const alreadyIssued = nfseDocumentStatus === "ISSUED";
    const cancelled = nfseDocumentStatus === "CANCELLED";
    const inFlight =
      nfseDocumentStatus === "QUEUED" ||
      nfseDocumentStatus === "PROCESSING";
    return {
      status: alreadyIssued ? "EXPORTED" : ready || cancelled ? "READY" : "PENDING",
      missingFields,
      needsReexport: false,
      canExportReceitaSaude: false,
      canPreviewNfse: Boolean(tx.patientId),
      canEmitNfse: ready && !alreadyIssued && !inFlight,
      canCancelNfse: alreadyIssued && issuerCanEmit && !nfseCancelRequested,
      nfseCancelRequested: alreadyIssued && nfseCancelRequested,
      nfseDocumentStatus,
    };
  }

  if (!isPfCarneLeaoRegime(professional.fiscalRegime)) {
    return {
      status: "NOT_APPLICABLE",
      missingFields: ["Regime PF (Receita Saúde) no perfil"],
      needsReexport: false,
      canExportReceitaSaude: false,
      canPreviewNfse: false,
      canEmitNfse: false,
      canCancelNfse: false,
      nfseCancelRequested: false,
      nfseDocumentStatus: null,
    };
  }

  const missingFields = listMissingFiscalFields(professional, patient, Boolean(tx.patientId));
  const ready = missingFields.length === 0;

  const needsReexport =
    tx.fiscalExportStatus === "EXPORTED" &&
    tx.fiscalExportContentHash != null &&
    tx.currentContentHash != null &&
    tx.fiscalExportContentHash !== tx.currentContentHash;

  let status: FiscalExportStatus;
  if (!ready) {
    status = "PENDING";
  } else if (tx.fiscalExportStatus === "EXPORTED" && !needsReexport) {
    status = "EXPORTED";
  } else {
    status = "READY";
  }

  return {
    status,
    missingFields,
    needsReexport,
    canExportReceitaSaude: ready,
    canPreviewNfse: false,
    canEmitNfse: false,
    canCancelNfse: false,
    nfseCancelRequested: false,
    nfseDocumentStatus: null,
  };
}

export const FISCAL_STATUS_LABEL: Record<FiscalExportStatus, string> = {
  NOT_APPLICABLE: "—",
  PENDING: "Fiscal pendente",
  READY: "Pronto p/ export",
  EXPORTED: "CSV exportado",
};

export const NFSE_DOCUMENT_STATUS_LABEL: Record<string, string> = {
  QUEUED: "NFS-e na fila",
  PROCESSING: "NFS-e processando",
  ISSUED: "NFS-e emitida",
  ERROR: "Erro NFS-e",
  CANCELLED: "NFS-e cancelada",
  CANCEL_REQUESTED: "Cancelamento pendente",
};
