-- Evolução Visual: unit, reasoning, ligação opcional a exame analisado
ALTER TABLE "PatientMetric" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "PatientMetric" ADD COLUMN IF NOT EXISTS "reasoning" TEXT;
ALTER TABLE "PatientMetric" ADD COLUMN IF NOT EXISTS "patientExamId" TEXT;

CREATE INDEX IF NOT EXISTS "PatientMetric_patientExamId_idx" ON "PatientMetric"("patientExamId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PatientMetric_patientExamId_fkey'
  ) THEN
    ALTER TABLE "PatientMetric"
      ADD CONSTRAINT "PatientMetric_patientExamId_fkey"
      FOREIGN KEY ("patientExamId") REFERENCES "PatientExam"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
