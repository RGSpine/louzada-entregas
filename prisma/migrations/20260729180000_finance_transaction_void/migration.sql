-- Estorno controlado de lançamentos + índice único parcial ignora voided.
ALTER TABLE "FinancialTransaction"
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT;

DROP INDEX IF EXISTS "FinancialTransaction_purchase_id_income_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS
  "FinancialTransaction_purchase_id_income_uidx"
  ON "FinancialTransaction" ("purchase_id")
  WHERE kind = 'INCOME' AND purchase_id IS NOT NULL AND voided_at IS NULL;
