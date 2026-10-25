-- Convite único do profissional para o paciente criar conta e vincular.
CREATE TABLE IF NOT EXISTS "ProfessionalMapInvite" (
  "id" TEXT NOT NULL,
  "token" VARCHAR(80) NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "professional_user_id" TEXT NOT NULL,
  "chart_patient_id" TEXT NOT NULL,
  "accepted_health_profile_id" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalMapInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfessionalMapInvite_token_key"
  ON "ProfessionalMapInvite"("token");
CREATE INDEX IF NOT EXISTS "ProfessionalMapInvite_chart_patient_id_accepted_at_idx"
  ON "ProfessionalMapInvite"("chart_patient_id", "accepted_at");
CREATE INDEX IF NOT EXISTS "ProfessionalMapInvite_professional_user_id_created_at_idx"
  ON "ProfessionalMapInvite"("professional_user_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalMapInvite_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalMapInvite"
      ADD CONSTRAINT "ProfessionalMapInvite_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalMapInvite_chart_patient_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalMapInvite"
      ADD CONSTRAINT "ProfessionalMapInvite_chart_patient_id_fkey"
      FOREIGN KEY ("chart_patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalMapInvite_accepted_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalMapInvite"
      ADD CONSTRAINT "ProfessionalMapInvite_accepted_health_profile_id_fkey"
      FOREIGN KEY ("accepted_health_profile_id") REFERENCES "HealthProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
