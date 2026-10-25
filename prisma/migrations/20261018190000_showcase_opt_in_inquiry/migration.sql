-- Card da vitrine: opt-in do profissional, especialidade, média de valores
-- e mensagem do paciente logado para agendar.

ALTER TABLE "ProfessionalProfile"
  ADD COLUMN IF NOT EXISTS "public_specialty" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "public_average_price" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "showcase_approved" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ProfessionalProfile_showcase_approved_idx"
  ON "ProfessionalProfile"("showcase_approved");

CREATE TABLE IF NOT EXISTS "ShowcaseInquiry" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(6),
  CONSTRAINT "ShowcaseInquiry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseInquiry_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseInquiry"
      ADD CONSTRAINT "ShowcaseInquiry_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseInquiry_patient_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseInquiry"
      ADD CONSTRAINT "ShowcaseInquiry_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ShowcaseInquiry_professional_profile_id_created_at_idx"
  ON "ShowcaseInquiry"("professional_profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "ShowcaseInquiry_patient_id_created_at_idx"
  ON "ShowcaseInquiry"("patient_id", "created_at");

ALTER TABLE "ShowcaseInquiry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_showcaseinquiry" ON "ShowcaseInquiry";
CREATE POLICY "deny_postgrest_showcaseinquiry"
  ON "ShowcaseInquiry"
  FOR ALL
  USING (false)
  WITH CHECK (false);
