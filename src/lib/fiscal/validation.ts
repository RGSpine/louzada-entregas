import { z } from "zod";

const KNOWN_INVALID_CPFS = new Set([
  "00000000000",
  "11111111111",
  "22222222222",
  "33333333333",
  "44444444444",
  "55555555555",
  "66666666666",
  "77777777777",
  "88888888888",
  "99999999999",
]);

function computeCpfCheckDigit(digits: number[], factorStart: number): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (factorStart - i);
  }
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

export function normalizeTaxId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function validateCpf(digitsRaw: string): boolean {
  const digits = normalizeTaxId(digitsRaw);
  if (!digits || digits.length !== 11) return false;
  if (KNOWN_INVALID_CPFS.has(digits)) return false;

  const nums = digits.split("").map(Number);
  const d1 = computeCpfCheckDigit(nums.slice(0, 9), 10);
  if (d1 !== nums[9]) return false;
  const d2 = computeCpfCheckDigit(nums.slice(0, 10), 11);
  return d2 === nums[10];
}

export function validateCnpj(digitsRaw: string): boolean {
  const digits = normalizeTaxId(digitsRaw);
  if (!digits || digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const nums = digits.split("").map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += nums[i] * w1[i];
  let mod = sum % 11;
  const d1 = mod < 2 ? 0 : 11 - mod;
  if (d1 !== nums[12]) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += nums[i] * w2[i];
  mod = sum % 11;
  const d2 = mod < 2 ? 0 : 11 - mod;
  return d2 === nums[13];
}

export function formatCpfInput(raw: string): string {
  const d = normalizeTaxId(raw)?.slice(0, 11) ?? "";
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCnpjInput(raw: string): string {
  const d = normalizeTaxId(raw)?.slice(0, 14) ?? "";
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Mascara CPF para exibição (LGPD). */
export function maskCpf(digitsRaw: string | null | undefined): string {
  const d = normalizeTaxId(digitsRaw);
  if (!d || d.length !== 11) return "—";
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

export const fiscalRegimeSchema = z.enum([
  "PF_CARNE_LEAO",
  "PJ_SIMPLES",
  "PJ_PRESUMIDO",
  "UNSPECIFIED",
]);

export const updateFiscalProfileSchema = z
  .object({
    fiscalRegime: fiscalRegimeSchema,
    professionalCpf: z.string().optional().or(z.literal("")),
    professionalCnpj: z.string().optional().or(z.literal("")),
    carneLeaoOccupationCode: z.string().optional().or(z.literal("")),
    nfseServiceCode: z.string().optional().or(z.literal("")),
    nfseIssAliquotaPercent: z.coerce.number().optional(),
    issuerRazaoSocial: z.string().optional().or(z.literal("")),
    issuerInscricaoMunicipal: z.string().optional().or(z.literal("")),
    issuerCodigoMunicipio: z.string().optional().or(z.literal("")),
    issuerAddressLogradouro: z.string().optional().or(z.literal("")),
    issuerAddressNumero: z.string().optional().or(z.literal("")),
    issuerAddressBairro: z.string().optional().or(z.literal("")),
    issuerAddressCidade: z.string().optional().or(z.literal("")),
    issuerAddressUf: z.string().optional().or(z.literal("")),
    issuerAddressCep: z.string().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const cpf = normalizeTaxId(data.professionalCpf);
    if (data.fiscalRegime === "PF_CARNE_LEAO") {
      if (!cpf) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o CPF profissional para exportação Receita Saúde.",
          path: ["professionalCpf"],
        });
      } else if (!validateCpf(cpf)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CPF profissional inválido.",
          path: ["professionalCpf"],
        });
      }
      const occ = data.carneLeaoOccupationCode?.trim();
      if (!occ || !/^\d{3}$/.test(occ)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o código de ocupação Carnê-Leão (3 dígitos).",
          path: ["carneLeaoOccupationCode"],
        });
      }
    }
    if (data.fiscalRegime === "PJ_SIMPLES" || data.fiscalRegime === "PJ_PRESUMIDO") {
      const cnpj = normalizeTaxId(data.professionalCnpj);
      if (!cnpj) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o CNPJ do consultório.",
          path: ["professionalCnpj"],
        });
      } else if (!validateCnpj(cnpj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CNPJ inválido.",
          path: ["professionalCnpj"],
        });
      }
      const serviceCode = data.nfseServiceCode?.trim();
      if (!serviceCode || serviceCode.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o código de serviço NFS-e (ex.: 04.01).",
          path: ["nfseServiceCode"],
        });
      }
      const iss = data.nfseIssAliquotaPercent;
      if (iss == null || Number.isNaN(iss) || iss < 0 || iss > 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe a alíquota ISS (0–20%).",
          path: ["nfseIssAliquotaPercent"],
        });
      }
      const razao = data.issuerRazaoSocial?.trim();
      if (!razao || razao.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe a razão social do consultório.",
          path: ["issuerRazaoSocial"],
        });
      }
      const cidade = data.issuerAddressCidade?.trim();
      const uf = data.issuerAddressUf?.trim();
      if (!cidade || !uf || uf.length !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe cidade e UF do consultório.",
          path: ["issuerAddressCidade"],
        });
      }
      const cep = normalizeTaxId(data.issuerAddressCep);
      if (!cep || cep.length !== 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe o CEP do consultório (8 dígitos).",
          path: ["issuerAddressCep"],
        });
      }
    }
  });

export const updatePatientFiscalSchema = z
  .object({
    patientId: z.string().min(1),
    cpf: z.string().optional().or(z.literal("")),
    payerCpf: z.string().optional().or(z.literal("")),
    fiscalConsent: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const cpf = normalizeTaxId(data.cpf);
    const payer = normalizeTaxId(data.payerCpf);

    if (cpf && !validateCpf(cpf)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CPF do beneficiário inválido.", path: ["cpf"] });
    }
    if (payer && !validateCpf(payer)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CPF do pagador inválido.", path: ["payerCpf"] });
    }
    if ((cpf || payer) && !data.fiscalConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "É necessário consentimento para armazenar dados fiscais.",
        path: ["fiscalConsent"],
      });
    }
  });

export const fiscalExportBatchSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1).max(1000),
});

export const fiscalIssuerCertificateSchema = z.object({
  password: z.string().min(1, "Informe a senha do certificado."),
});
