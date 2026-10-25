"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolveCarneLeaoOccupationCode } from "@/lib/fiscal/carne-leao-occupation";
import {
  normalizeTaxId,
  updateFiscalProfileSchema,
  updatePatientFiscalSchema,
  maskCpf,
} from "@/lib/fiscal/validation";
import type { FiscalRegime } from "@prisma/client";
import { z } from "zod";
import { requireFinanceAdmin } from "@/lib/finance/finance-rbac";

export interface FiscalProfileData {
  fiscalRegime: FiscalRegime;
  professionalCpf: string | null;
  professionalCpfMasked: string;
  professionalCnpj: string | null;
  professionalCnpjMasked: string;
  carneLeaoOccupationCode: string | null;
  profession: string | null;
  nfseServiceCode: string | null;
  nfseIssAliquotaPercent: number | null;
  issuerRazaoSocial: string | null;
  issuerInscricaoMunicipal: string | null;
  issuerCodigoMunicipio: string | null;
  issuerAddressLogradouro: string | null;
  issuerAddressNumero: string | null;
  issuerAddressBairro: string | null;
  issuerAddressCidade: string | null;
  issuerAddressUf: string | null;
  issuerAddressCep: string | null;
}

type ActionResult<T = void> =
  | (T extends void ? { success: true; data?: undefined } : { success: true; data: T })
  | { success: false; error: string };

async function requireFiscalUser(): Promise<ActionResult<{ userId: string }>> {
  const admin = await requireFinanceAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  return { success: true, data: { userId: admin.userId } };
}

export async function getMyFiscalProfile(): Promise<ActionResult<FiscalProfileData>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      fiscalRegime: true,
      professionalCpf: true,
      professionalCnpj: true,
      carneLeaoOccupationCode: true,
      profession: true,
      nfseServiceCode: true,
      nfseIssAliquotaPercent: true,
      fiscalIssuerProfile: {
        select: {
          razaoSocial: true,
          inscricaoMunicipal: true,
          codigoMunicipio: true,
          addressLogradouro: true,
          addressNumero: true,
          addressBairro: true,
          addressCidade: true,
          addressUf: true,
          addressCep: true,
        },
      },
    },
  });
  if (!user) return { success: false, error: "Usuário não encontrado." };

  const issuer = user.fiscalIssuerProfile;

  return {
    success: true,
    data: {
      fiscalRegime: user.fiscalRegime,
      professionalCpf: user.professionalCpf,
      professionalCpfMasked: maskCpf(user.professionalCpf),
      professionalCnpj: user.professionalCnpj,
      professionalCnpjMasked: user.professionalCnpj
        ? `**.${user.professionalCnpj.slice(2, 5)}.${user.professionalCnpj.slice(5, 8)}/****-**`
        : "—",
      carneLeaoOccupationCode:
        user.carneLeaoOccupationCode ??
        resolveCarneLeaoOccupationCode(user.profession, null),
      profession: user.profession,
      nfseServiceCode: user.nfseServiceCode,
      nfseIssAliquotaPercent: user.nfseIssAliquotaPercent,
      issuerRazaoSocial: issuer?.razaoSocial ?? null,
      issuerInscricaoMunicipal: issuer?.inscricaoMunicipal ?? null,
      issuerCodigoMunicipio: issuer?.codigoMunicipio ?? null,
      issuerAddressLogradouro: issuer?.addressLogradouro ?? null,
      issuerAddressNumero: issuer?.addressNumero ?? null,
      issuerAddressBairro: issuer?.addressBairro ?? null,
      issuerAddressCidade: issuer?.addressCidade ?? null,
      issuerAddressUf: issuer?.addressUf ?? null,
      issuerAddressCep: issuer?.addressCep ?? null,
    },
  };
}

export async function updateMyFiscalProfile(input: unknown): Promise<ActionResult> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const parsed = updateFiscalProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const {
    fiscalRegime,
    professionalCpf,
    professionalCnpj,
    carneLeaoOccupationCode,
    nfseServiceCode,
    nfseIssAliquotaPercent,
    issuerRazaoSocial,
    issuerInscricaoMunicipal,
    issuerCodigoMunicipio,
    issuerAddressLogradouro,
    issuerAddressNumero,
    issuerAddressBairro,
    issuerAddressCidade,
    issuerAddressUf,
    issuerAddressCep,
  } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profession: true },
  });

  const occupation =
    fiscalRegime === "PF_CARNE_LEAO"
      ? (carneLeaoOccupationCode?.trim() ||
          resolveCarneLeaoOccupationCode(user?.profession, null))
      : null;

  const isPj = fiscalRegime === "PJ_SIMPLES" || fiscalRegime === "PJ_PRESUMIDO";

  await prisma.user.update({
    where: { id: userId },
    data: {
      fiscalRegime,
      professionalCpf:
        fiscalRegime === "PF_CARNE_LEAO" ? normalizeTaxId(professionalCpf) : null,
      professionalCnpj: isPj ? normalizeTaxId(professionalCnpj) : null,
      carneLeaoOccupationCode: occupation,
      nfseServiceCode: isPj ? nfseServiceCode?.trim() || null : null,
      nfseIssAliquotaPercent: isPj ? nfseIssAliquotaPercent ?? null : null,
    },
  });

  if (isPj) {
    await prisma.fiscalIssuerProfile.upsert({
      where: { userId },
      create: {
        userId,
        razaoSocial: issuerRazaoSocial?.trim() || null,
        inscricaoMunicipal: issuerInscricaoMunicipal?.trim() || null,
        codigoMunicipio: issuerCodigoMunicipio?.replace(/\D/g, "").slice(0, 7) || null,
        addressLogradouro: issuerAddressLogradouro?.trim() || null,
        addressNumero: issuerAddressNumero?.trim() || null,
        addressBairro: issuerAddressBairro?.trim() || null,
        addressCidade: issuerAddressCidade?.trim() || null,
        addressUf: issuerAddressUf?.trim().toUpperCase().slice(0, 2) || null,
        addressCep: normalizeTaxId(issuerAddressCep),
      },
      update: {
        razaoSocial: issuerRazaoSocial?.trim() || null,
        inscricaoMunicipal: issuerInscricaoMunicipal?.trim() || null,
        codigoMunicipio: issuerCodigoMunicipio?.replace(/\D/g, "").slice(0, 7) || null,
        addressLogradouro: issuerAddressLogradouro?.trim() || null,
        addressNumero: issuerAddressNumero?.trim() || null,
        addressBairro: issuerAddressBairro?.trim() || null,
        addressCidade: issuerAddressCidade?.trim() || null,
        addressUf: issuerAddressUf?.trim().toUpperCase().slice(0, 2) || null,
        addressCep: normalizeTaxId(issuerAddressCep),
      },
    });
  } else {
    await prisma.fiscalIssuerProfile.deleteMany({ where: { userId } });
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/finances");
  return { success: true };
}

export async function updatePatientFiscalData(input: unknown): Promise<ActionResult> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const parsed = updatePatientFiscalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const { patientId, cpf, payerCpf, fiscalConsent } = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, userId },
    select: { id: true },
  });
  if (!patient) return { success: false, error: "Paciente não encontrado." };

  const cpfDigits = normalizeTaxId(cpf);
  const payerDigits = normalizeTaxId(payerCpf);

  if (!cpfDigits && !payerDigits) {
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        cpf: null,
        payerCpf: null,
        fiscalDataConsentAt: null,
      },
    });
  } else {
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        cpf: cpfDigits,
        payerCpf: payerDigits,
        fiscalDataConsentAt: fiscalConsent ? new Date() : null,
      },
    });
  }

  revalidatePath(`/dashboard/patients/${patientId}`);
  revalidatePath("/dashboard/finances");
  return { success: true };
}

export interface PatientFiscalSummary {
  cpfMasked: string;
  payerCpfMasked: string;
  hasConsent: boolean;
}

export async function getPatientFiscalSummary(
  input: unknown,
): Promise<ActionResult<PatientFiscalSummary>> {
  const auth = await requireFiscalUser();
  if (!auth.success) return auth;
  const userId = auth.data.userId;

  const parsed = z.object({ patientId: z.string().min(1) }).safeParse(
    typeof input === "string" ? { patientId: input } : input,
  );
  if (!parsed.success) {
    return { success: false, error: "Identificador do paciente inválido." };
  }
  const { patientId } = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, userId },
    select: { cpf: true, payerCpf: true, fiscalDataConsentAt: true },
  });
  if (!patient) return { success: false, error: "Paciente não encontrado." };

  return {
    success: true,
    data: {
      cpfMasked: maskCpf(patient.cpf),
      payerCpfMasked: maskCpf(patient.payerCpf),
      hasConsent: patient.fiscalDataConsentAt != null,
    },
  };
}
