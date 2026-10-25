-- CreateEnum
CREATE TYPE "ServiceBillingMode" AS ENUM ('SESSION', 'MONTHLY');

-- AlterTable ProfessionalService
ALTER TABLE "ProfessionalService" ADD COLUMN "billing_mode" "ServiceBillingMode" NOT NULL DEFAULT 'SESSION';

-- AlterTable PatientServicePurchase
ALTER TABLE "PatientServicePurchase" ADD COLUMN "billing_mode" "ServiceBillingMode" NOT NULL DEFAULT 'SESSION';
ALTER TABLE "PatientServicePurchase" ADD COLUMN "period_start" TIMESTAMPTZ(6);
ALTER TABLE "PatientServicePurchase" ADD COLUMN "period_end" TIMESTAMPTZ(6);

CREATE INDEX "PatientServicePurchase_professional_user_id_billing_mode_idx" ON "PatientServicePurchase"("professional_user_id", "billing_mode");
