import type { NotaasEmitPayload } from "@/lib/fiscal/providers/types";
import {
  DEFAULT_NFSE_ISS_ALIQUOTA_PERCENT,
  resolveDefaultNfseServiceCode,
} from "@/lib/fiscal/nfse-service-codes";

export type BuildNfsePayloadInput = {
  patientName: string;
  patientCpf: string;
  amountCents: number;
  description: string | null;
  profession: string | null;
  nfseServiceCode: string | null;
  nfseIssAliquotaPercent: number | null;
};

export function buildNfseEmitPayload(input: BuildNfsePayloadInput): NotaasEmitPayload {
  const serviceCode = resolveDefaultNfseServiceCode(
    input.profession,
    input.nfseServiceCode,
  );
  if (!serviceCode) {
    throw new Error("Código de serviço NFS-e não configurado.");
  }

  const aliquota =
    input.nfseIssAliquotaPercent != null && input.nfseIssAliquotaPercent >= 0
      ? input.nfseIssAliquotaPercent
      : DEFAULT_NFSE_ISS_ALIQUOTA_PERCENT;

  const descricao =
    (input.description?.trim() || "Serviços de saúde").slice(0, 2000);

  return {
    tomador: {
      nome: input.patientName.trim(),
      cpf: input.patientCpf,
    },
    servico: {
      codigo: serviceCode,
      descricao,
    },
    valores: {
      total: Math.round((input.amountCents / 100) * 100) / 100,
      aliquotaIss: aliquota,
    },
  };
}
