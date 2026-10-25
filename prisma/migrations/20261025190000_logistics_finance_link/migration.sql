-- Receita do áudio fica no Financeiro, ligada à coleta ou à entrega.
-- A agenda continua só com a ordem.

ALTER TABLE "FinancialTransaction"
  ADD COLUMN IF NOT EXISTS "logistics_task_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialTransaction_logistics_task_id_key"
  ON "FinancialTransaction"("logistics_task_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinancialTransaction_logistics_task_id_fkey'
  ) THEN
    ALTER TABLE "FinancialTransaction"
      ADD CONSTRAINT "FinancialTransaction_logistics_task_id_fkey"
      FOREIGN KEY ("logistics_task_id") REFERENCES "LogisticsTask"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
