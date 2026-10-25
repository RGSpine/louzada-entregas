-- Campos para sync bidirecional com Google Calendar
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "google_calendar_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_calendar_last_synced_at" TIMESTAMPTZ(6);
