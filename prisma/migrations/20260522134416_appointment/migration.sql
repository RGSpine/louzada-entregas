/*
  Warnings:

  - A unique constraint covering the columns `[stripe_customer_id]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripe_subscription_id]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- Idempotente: seguro apos db push ou retry quando colunas/indice ja existem.

ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "clinicalMeta" JSONB;
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "tags" TEXT[];

ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "clinicalSummary" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "lastVisit" TIMESTAMP(3);
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "metrics" JSONB;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "evolutionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "evolution_count_reset_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "is_influencer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "patientCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan_interval" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripe_price_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT;

CREATE INDEX IF NOT EXISTS "Evolution_tags_idx" ON "Evolution"("tags");
CREATE INDEX IF NOT EXISTS "Patient_lastVisit_idx" ON "Patient"("lastVisit");
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripe_customer_id_key" ON "User"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripe_subscription_id_key" ON "User"("stripe_subscription_id");

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'SessionConsumptionEvent_professional_user_id_patient_id_calenda'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'SessionConsumptionEvent_professional_user_id_patient_id_cal_idx'
  ) THEN
    ALTER INDEX "SessionConsumptionEvent_professional_user_id_patient_id_calenda"
      RENAME TO "SessionConsumptionEvent_professional_user_id_patient_id_cal_idx";
  END IF;
END $do$;
