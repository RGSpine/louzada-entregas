-- Comissão por Intra User + repasses (Consultório/Clínica).
-- Isolamento: CollaboratorPayout.professional_user_id = tenant; IntraUser.user_id deve coincidir.

ALTER TYPE "FinancialEntrySource" ADD VALUE IF NOT EXISTS 'COLLABORATOR_PAYOUT';

DO $$ BEGIN
  CREATE TYPE "CollaboratorPayoutPeriod" AS ENUM ('WEEK', 'FORTNIGHT', 'MONTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "IntraUser"
  ADD COLUMN IF NOT EXISTS "commission_rate_bps" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "FinancialTransaction"
  ADD COLUMN IF NOT EXISTS "intra_user_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinancialTransaction_intra_user_id_fkey'
  ) THEN
    ALTER TABLE "FinancialTransaction"
      ADD CONSTRAINT "FinancialTransaction_intra_user_id_fkey"
      FOREIGN KEY ("intra_user_id") REFERENCES "IntraUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FinancialTransaction_intra_user_id_occurred_at_idx"
  ON "FinancialTransaction"("intra_user_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "CollaboratorPayout" (
  "id" TEXT NOT NULL,
  "professional_user_id" TEXT NOT NULL,
  "intra_user_id" TEXT NOT NULL,
  "period" "CollaboratorPayoutPeriod" NOT NULL,
  "period_key" TEXT NOT NULL,
  "period_start_utc" TIMESTAMPTZ(6) NOT NULL,
  "period_end_utc" TIMESTAMPTZ(6) NOT NULL,
  "commission_rate_bps" INTEGER NOT NULL,
  "base_cents" INTEGER NOT NULL,
  "commission_due_cents" INTEGER NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "financial_transaction_id" TEXT NOT NULL,
  "notes" TEXT,
  "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollaboratorPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CollaboratorPayout_financial_transaction_id_key"
  ON "CollaboratorPayout"("financial_transaction_id");

CREATE INDEX IF NOT EXISTS "CollaboratorPayout_professional_user_id_period_key_idx"
  ON "CollaboratorPayout"("professional_user_id", "period_key");

CREATE INDEX IF NOT EXISTS "CollaboratorPayout_intra_user_id_period_key_idx"
  ON "CollaboratorPayout"("intra_user_id", "period_key");

CREATE INDEX IF NOT EXISTS "CollaboratorPayout_professional_user_id_paid_at_idx"
  ON "CollaboratorPayout"("professional_user_id", "paid_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CollaboratorPayout_professional_user_id_fkey'
  ) THEN
    ALTER TABLE "CollaboratorPayout"
      ADD CONSTRAINT "CollaboratorPayout_professional_user_id_fkey"
      FOREIGN KEY ("professional_user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CollaboratorPayout_intra_user_id_fkey'
  ) THEN
    ALTER TABLE "CollaboratorPayout"
      ADD CONSTRAINT "CollaboratorPayout_intra_user_id_fkey"
      FOREIGN KEY ("intra_user_id") REFERENCES "IntraUser"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CollaboratorPayout_financial_transaction_id_fkey'
  ) THEN
    ALTER TABLE "CollaboratorPayout"
      ADD CONSTRAINT "CollaboratorPayout_financial_transaction_id_fkey"
      FOREIGN KEY ("financial_transaction_id") REFERENCES "FinancialTransaction"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "CollaboratorPayout" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_collaboratorpayout" ON "CollaboratorPayout";
CREATE POLICY "deny_postgrest_collaboratorpayout" ON "CollaboratorPayout"
  FOR ALL USING (false) WITH CHECK (false);
