-- CreateEnum
CREATE TYPE "FiscalRegime" AS ENUM ('PF_CARNE_LEAO', 'PJ_SIMPLES', 'PJ_PRESUMIDO', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "FiscalExportStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'READY', 'EXPORTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "fiscal_regime" "FiscalRegime" NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE "User" ADD COLUMN "professional_cpf" VARCHAR(11);
ALTER TABLE "User" ADD COLUMN "professional_cnpj" VARCHAR(14);
ALTER TABLE "User" ADD COLUMN "carne_leao_occupation_code" VARCHAR(3);

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "cpf" VARCHAR(11);
ALTER TABLE "Patient" ADD COLUMN "payer_cpf" VARCHAR(11);
ALTER TABLE "Patient" ADD COLUMN "fiscal_data_consent_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN "fiscal_export_status" "FiscalExportStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "FinancialTransaction" ADD COLUMN "fiscal_exported_at" TIMESTAMPTZ(6);
ALTER TABLE "FinancialTransaction" ADD COLUMN "fiscal_export_content_hash" VARCHAR(64);
