-- Google Agenda do paciente B2C + vínculo do evento na marcação.

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "patient_google_calendar_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "patient_google_calendar_updated_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "patient_google_calendar_account" (
  "id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "provider_account_id" TEXT,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "expires_at" INTEGER,
  "scope" TEXT,
  "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "patient_google_calendar_account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "patient_google_calendar_account_patient_id_key"
  ON "patient_google_calendar_account"("patient_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_google_calendar_account_patient_id_fkey'
  ) THEN
    ALTER TABLE "patient_google_calendar_account"
      ADD CONSTRAINT "patient_google_calendar_account_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
