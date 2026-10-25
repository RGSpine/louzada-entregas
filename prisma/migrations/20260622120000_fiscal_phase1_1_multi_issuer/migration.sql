-- CreateEnum
CREATE TYPE "FiscalIssuerStatus" AS ENUM ('PENDING_SETUP', 'PROJECT_REGISTERED', 'CERTIFICATE_ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "FiscalCertificateStatus" AS ENUM ('NONE', 'ACTIVE', 'EXPIRED', 'ERROR');

-- CreateTable
CREATE TABLE "FiscalIssuerProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "FiscalProviderKind" NOT NULL DEFAULT 'NOTAAS',
    "status" "FiscalIssuerStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "external_project_id" TEXT,
    "external_api_key_id" TEXT,
    "encrypted_project_api_key" TEXT,
    "api_key_prefix" VARCHAR(32),
    "razao_social" TEXT,
    "inscricao_municipal" VARCHAR(32),
    "codigo_municipio" VARCHAR(7),
    "address_logradouro" TEXT,
    "address_numero" VARCHAR(20),
    "address_bairro" TEXT,
    "address_cidade" TEXT,
    "address_uf" VARCHAR(2),
    "address_cep" VARCHAR(8),
    "certificate_status" "FiscalCertificateStatus" NOT NULL DEFAULT 'NONE',
    "certificate_valid_until" TIMESTAMPTZ(6),
    "certificate_subject_cn" TEXT,
    "certificate_days_until_exp" INTEGER,
    "last_error" TEXT,
    "registered_at" TIMESTAMPTZ(6),
    "certificate_uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalIssuerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIssuerProfile_user_id_key" ON "FiscalIssuerProfile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIssuerProfile_external_project_id_key" ON "FiscalIssuerProfile"("external_project_id");

-- CreateIndex
CREATE INDEX "FiscalIssuerProfile_status_idx" ON "FiscalIssuerProfile"("status");

-- AddForeignKey
ALTER TABLE "FiscalIssuerProfile" ADD CONSTRAINT "FiscalIssuerProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
