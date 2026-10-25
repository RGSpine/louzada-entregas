-- Idempotência de vendas originadas por múltiplos canais.
ALTER TABLE "PatientServicePurchase"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "origin_appointment_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
  "PatientServicePurchase_professional_user_id_idempotency_key_key"
  ON "PatientServicePurchase"("professional_user_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS
  "PatientServicePurchase_origin_appointment_id_key"
  ON "PatientServicePurchase"("origin_appointment_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SessionConsumptionEvent"
    GROUP BY "session_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Há sessões com mais de um evento de consumo. Corrija os registros antes de aplicar a unicidade.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "SessionConsumptionEvent_session_id_key"
  ON "SessionConsumptionEvent"("session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PatientServicePurchase_origin_appointment_id_fkey'
  ) THEN
    ALTER TABLE "PatientServicePurchase"
      ADD CONSTRAINT "PatientServicePurchase_origin_appointment_id_fkey"
      FOREIGN KEY ("origin_appointment_id")
      REFERENCES "Appointment"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
