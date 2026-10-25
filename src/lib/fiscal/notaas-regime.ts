import type { FiscalRegime } from "@prisma/client";

/** Mapeia regime Louzada Entregas → regime Notaas (Org API). */
export function mapFiscalRegimeToNotaas(
  regime: FiscalRegime,
): "1" | "2" | "3" | "3e" | null {
  switch (regime) {
    case "PJ_SIMPLES":
      return "3";
    case "PJ_PRESUMIDO":
      return "1";
    default:
      return null;
  }
}

export type NotaasProjectInput = {
  name: string;
  cnpj: string;
  razaoSocial: string;
  regimeTributario: "1" | "2" | "3" | "3e";
  inscricaoMunicipal?: string | null;
  codigoMunicipio?: string | null;
  codigoTributacao?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: {
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    cep?: string | null;
  };
};

export function buildNotaasProjectPayload(input: {
  cnpj: string;
  razaoSocial: string;
  fiscalRegime: FiscalRegime;
  inscricaoMunicipal?: string | null;
  codigoMunicipio?: string | null;
  nfseServiceCode?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLogradouro?: string | null;
  addressNumero?: string | null;
  addressBairro?: string | null;
  addressCidade?: string | null;
  addressUf?: string | null;
  addressCep?: string | null;
}): NotaasProjectInput {
  const regime = mapFiscalRegimeToNotaas(input.fiscalRegime);
  if (!regime) {
    throw new Error("Regime tributário não suportado para emitente Notaas.");
  }

  const name = input.razaoSocial.trim().slice(0, 80) || `CNPJ ${input.cnpj}`;

  return {
    name,
    cnpj: input.cnpj,
    razaoSocial: input.razaoSocial.trim(),
    regimeTributario: regime,
    inscricaoMunicipal: input.inscricaoMunicipal?.trim() || undefined,
    codigoMunicipio: input.codigoMunicipio?.replace(/\D/g, "").slice(0, 7) || undefined,
    codigoTributacao: input.nfseServiceCode?.trim() || undefined,
    email: input.email?.trim() || undefined,
    telefone: input.phone?.replace(/\D/g, "") || undefined,
    endereco: {
      logradouro: input.addressLogradouro?.trim() || undefined,
      numero: input.addressNumero?.trim() || undefined,
      bairro: input.addressBairro?.trim() || undefined,
      cidade: input.addressCidade?.trim() || undefined,
      uf: input.addressUf?.trim().toUpperCase().slice(0, 2) || undefined,
      cep: input.addressCep?.replace(/\D/g, "").slice(0, 8) || undefined,
    },
  };
}

export const MAX_CERTIFICATE_BYTES = 50 * 1024;

export const ALLOWED_CERTIFICATE_EXTENSIONS = new Set([".pfx", ".p12"]);
