-- Extracao financeira (IA): fila paralela aos jobs da Nova Evolucao; reutiliza o mesmo enum Postgres.
-- Idempotente: seguro apos db push ou retry apos falha parcial.

CREATE TABLE IF NOT EXISTS "OfficeFinanceExtractionJob" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "EvolutionProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "request_data" JSONB NOT NULL,
    "result_data" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeFinanceExtractionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OfficeFinanceExtractionJob_user_id_status_idx"
  ON "OfficeFinanceExtractionJob"("user_id", "status");

CREATE INDEX IF NOT EXISTS "OfficeFinanceExtractionJob_created_at_idx"
  ON "OfficeFinanceExtractionJob"("created_at");

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'OfficeFinanceExtractionJob_user_id_fkey'
  ) THEN
    ALTER TABLE "OfficeFinanceExtractionJob"
      ADD CONSTRAINT "OfficeFinanceExtractionJob_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $do$;
