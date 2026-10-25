-- Registro automático de receita ao marcar consulta/retorno como realizados
ALTER TYPE "FinancialEntrySource" ADD VALUE IF NOT EXISTS 'AGENDA';

ALTER TABLE "FinancialTransaction" ADD COLUMN IF NOT EXISTS "appointment_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialTransaction_appointment_id_key"
  ON "FinancialTransaction"("appointment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinancialTransaction_appointment_id_fkey'
  ) THEN
    ALTER TABLE "FinancialTransaction"
      ADD CONSTRAINT "FinancialTransaction_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
