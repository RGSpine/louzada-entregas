-- Conversa da vitrine e autorização para o paciente marcar na agenda.

ALTER TABLE "ProfessionalProfile"
  ADD COLUMN IF NOT EXISTS "allow_patient_agenda_booking" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShowcaseMessageAuthor') THEN
    CREATE TYPE "ShowcaseMessageAuthor" AS ENUM ('PATIENT', 'PROFESSIONAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ShowcaseMessage" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "author" "ShowcaseMessageAuthor" NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(6),
  CONSTRAINT "ShowcaseMessage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseMessage_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseMessage"
      ADD CONSTRAINT "ShowcaseMessage_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseMessage_patient_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseMessage"
      ADD CONSTRAINT "ShowcaseMessage_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ShowcaseMessage_professional_profile_id_patient_id_created_at_idx"
  ON "ShowcaseMessage"("professional_profile_id", "patient_id", "created_at");
CREATE INDEX IF NOT EXISTS "ShowcaseMessage_patient_id_created_at_idx"
  ON "ShowcaseMessage"("patient_id", "created_at");

ALTER TABLE "ShowcaseMessage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_showcasemessage" ON "ShowcaseMessage";
CREATE POLICY "deny_postgrest_showcasemessage"
  ON "ShowcaseMessage"
  FOR ALL
  USING (false)
  WITH CHECK (false);
