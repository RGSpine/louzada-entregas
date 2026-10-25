-- Falta justificada (NO_SHOW) e série de repetição na marcação manual.

ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "no_show_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "recurrence_series_id" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_recurrence_series_id_idx"
  ON "Appointment"("recurrence_series_id");
