-- Janelas de oferta (dias/horas/fixidez) + oferta manual na agenda.

DO $$
BEGIN
  CREATE TYPE "YieldWindowRecurrence" AS ENUM ('WEEKLY', 'ONCE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ScheduleSlot"
  ADD COLUMN IF NOT EXISTS "manual_offer" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ScheduleSlot_manual_offer_status_datetime_idx"
  ON "ScheduleSlot"("manual_offer", "status", "datetime");

CREATE TABLE IF NOT EXISTS "YieldOfferWindow" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "label" TEXT,
  "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "recurrence" "YieldWindowRecurrence" NOT NULL DEFAULT 'WEEKLY',
  "specific_date" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YieldOfferWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YieldOfferWindow_minutes_valid" CHECK (
    "start_minute" >= 0
    AND "end_minute" <= 1440
    AND "start_minute" < "end_minute"
  )
);

CREATE INDEX IF NOT EXISTS "YieldOfferWindow_professional_profile_id_is_active_idx"
  ON "YieldOfferWindow"("professional_profile_id", "is_active");

CREATE INDEX IF NOT EXISTS "YieldOfferWindow_recurrence_specific_date_idx"
  ON "YieldOfferWindow"("recurrence", "specific_date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'YieldOfferWindow_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "YieldOfferWindow"
      ADD CONSTRAINT "YieldOfferWindow_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
