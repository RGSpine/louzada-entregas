-- Fase 3 agenda: estado de confirmação (amarelo/verde)

CREATE TYPE "AppointmentConfirmationStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED');

ALTER TABLE "Appointment"
  ADD COLUMN "confirmation_status" "AppointmentConfirmationStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION';
