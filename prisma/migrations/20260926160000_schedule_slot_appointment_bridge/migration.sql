-- Ponte agenda B2B → slot do marketplace (idempotente).
ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS "appointment_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleSlot_appointment_id_fkey'
  ) THEN
    ALTER TABLE "ScheduleSlot"
      ADD CONSTRAINT "ScheduleSlot_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleSlot_appointment_id_key"
  ON "ScheduleSlot"("appointment_id");
