-- Espaços de Serviços (Consultório / Clínica)
CREATE TABLE IF NOT EXISTS "ServiceSpace" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL DEFAULT '#0F766E',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceSpace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ServiceSpace_user_id_active_idx" ON "ServiceSpace"("user_id", "active");
CREATE INDEX IF NOT EXISTS "ServiceSpace_user_id_sort_order_idx" ON "ServiceSpace"("user_id", "sort_order");

ALTER TABLE "ServiceSpace"
  ADD CONSTRAINT "ServiceSpace_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FKs opcionais nos modelos existentes
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;
ALTER TABLE "ProfessionalService" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;
ALTER TABLE "PatientServicePurchase" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;
ALTER TABLE "FinancialTransaction" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;
ALTER TABLE "RecurringExpense" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_service_space_id_idx" ON "Appointment"("service_space_id");
CREATE INDEX IF NOT EXISTS "ProfessionalService_service_space_id_idx" ON "ProfessionalService"("service_space_id");
CREATE INDEX IF NOT EXISTS "PatientServicePurchase_service_space_id_idx" ON "PatientServicePurchase"("service_space_id");
CREATE INDEX IF NOT EXISTS "FinancialTransaction_service_space_id_occurred_at_idx" ON "FinancialTransaction"("service_space_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "RecurringExpense_service_space_id_idx" ON "RecurringExpense"("service_space_id");

ALTER TABLE "Appointment"
  DROP CONSTRAINT IF EXISTS "Appointment_service_space_id_fkey";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_service_space_id_fkey"
  FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProfessionalService"
  DROP CONSTRAINT IF EXISTS "ProfessionalService_service_space_id_fkey";
ALTER TABLE "ProfessionalService"
  ADD CONSTRAINT "ProfessionalService_service_space_id_fkey"
  FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatientServicePurchase"
  DROP CONSTRAINT IF EXISTS "PatientServicePurchase_service_space_id_fkey";
ALTER TABLE "PatientServicePurchase"
  ADD CONSTRAINT "PatientServicePurchase_service_space_id_fkey"
  FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction"
  DROP CONSTRAINT IF EXISTS "FinancialTransaction_service_space_id_fkey";
ALTER TABLE "FinancialTransaction"
  ADD CONSTRAINT "FinancialTransaction_service_space_id_fkey"
  FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecurringExpense"
  DROP CONSTRAINT IF EXISTS "RecurringExpense_service_space_id_fkey";
ALTER TABLE "RecurringExpense"
  ADD CONSTRAINT "RecurringExpense_service_space_id_fkey"
  FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
