-- Marcação dupla nascida na conversa da vitrine.
-- Liga a agenda do profissional à agenda do paciente.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShowcaseDualBookingStatus') THEN
    CREATE TYPE "ShowcaseDualBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ShowcaseDualBooking" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "b2c_patient_id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "appointment_id" TEXT,
  "start_at" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "ShowcaseDualBookingStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShowcaseDualBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShowcaseDualBooking_appointment_id_key"
  ON "ShowcaseDualBooking"("appointment_id");
CREATE INDEX IF NOT EXISTS "ShowcaseDualBooking_profile_patient_start_idx"
  ON "ShowcaseDualBooking"("professional_profile_id", "b2c_patient_id", "start_at");
CREATE INDEX IF NOT EXISTS "ShowcaseDualBooking_patient_profile_start_idx"
  ON "ShowcaseDualBooking"("b2c_patient_id", "health_profile_id", "start_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseDualBooking_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseDualBooking"
      ADD CONSTRAINT "ShowcaseDualBooking_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseDualBooking_b2c_patient_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseDualBooking"
      ADD CONSTRAINT "ShowcaseDualBooking_b2c_patient_id_fkey"
      FOREIGN KEY ("b2c_patient_id") REFERENCES "Patient"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseDualBooking_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseDualBooking"
      ADD CONSTRAINT "ShowcaseDualBooking_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseDualBooking_appointment_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseDualBooking"
      ADD CONSTRAINT "ShowcaseDualBooking_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ShowcaseDualBooking" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_showcasedualbooking" ON "ShowcaseDualBooking";
CREATE POLICY "deny_postgrest_showcasedualbooking"
  ON "ShowcaseDualBooking"
  FOR ALL
  USING (false)
  WITH CHECK (false);
