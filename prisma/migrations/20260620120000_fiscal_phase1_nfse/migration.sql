-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('QUEUED', 'PROCESSING', 'ISSUED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalProviderKind" AS ENUM ('NOTAAS', 'FOCUS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "nfse_service_code" VARCHAR(20),
ADD COLUMN "nfse_iss_aliquota_percent" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "professional_user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "provider" "FiscalProviderKind" NOT NULL DEFAULT 'NOTAAS',
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'QUEUED',
    "external_invoice_id" TEXT,
    "nfse_number" TEXT,
    "nfse_access_key" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "pdf_url" TEXT,
    "xml_url" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "webhook_delivery_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_transaction_id_key" ON "FiscalDocument"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_idempotency_key_key" ON "FiscalDocument"("idempotency_key");

-- CreateIndex
CREATE INDEX "FiscalDocument_professional_user_id_status_idx" ON "FiscalDocument"("professional_user_id", "status");

-- CreateIndex
CREATE INDEX "FiscalDocument_external_invoice_id_idx" ON "FiscalDocument"("external_invoice_id");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_professional_user_id_fkey" FOREIGN KEY ("professional_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
