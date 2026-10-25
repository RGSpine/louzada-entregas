-- Vínculo paciente–profissional e atualizações compartilhadas de forma voluntária.
CREATE TABLE IF NOT EXISTS "ProfessionalPatientLink" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "initiated_by" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalPatientLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfessionalPatientLink_health_profile_id_professional_profile_id_key"
  ON "ProfessionalPatientLink"("health_profile_id", "professional_profile_id");
CREATE INDEX IF NOT EXISTS "ProfessionalPatientLink_professional_profile_id_status_idx"
  ON "ProfessionalPatientLink"("professional_profile_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalPatientLink_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalPatientLink"
      ADD CONSTRAINT "ProfessionalPatientLink_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalPatientLink_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalPatientLink"
      ADD CONSTRAINT "ProfessionalPatientLink_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SharedHealthUpdate" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "professional_user_id" TEXT NOT NULL,
  "chart_patient_id" TEXT,
  "kind" VARCHAR(20) NOT NULL,
  "source_id" TEXT NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "body" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'INBOX',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SharedHealthUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SharedHealthUpdate_professional_profile_id_kind_source_id_key"
  ON "SharedHealthUpdate"("professional_profile_id", "kind", "source_id");
CREATE INDEX IF NOT EXISTS "SharedHealthUpdate_professional_user_id_status_created_at_idx"
  ON "SharedHealthUpdate"("professional_user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "SharedHealthUpdate_chart_patient_id_status_idx"
  ON "SharedHealthUpdate"("chart_patient_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SharedHealthUpdate_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "SharedHealthUpdate"
      ADD CONSTRAINT "SharedHealthUpdate_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SharedHealthUpdate_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "SharedHealthUpdate"
      ADD CONSTRAINT "SharedHealthUpdate_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SharedHealthUpdate_chart_patient_id_fkey'
  ) THEN
    ALTER TABLE "SharedHealthUpdate"
      ADD CONSTRAINT "SharedHealthUpdate_chart_patient_id_fkey"
      FOREIGN KEY ("chart_patient_id") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
