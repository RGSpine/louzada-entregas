-- AlterEnum
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'OCR';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "google_calendar_event_id" TEXT;
