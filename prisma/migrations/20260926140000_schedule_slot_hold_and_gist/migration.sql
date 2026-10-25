-- Reserva temporária + reforço PostGIS/GIST (idempotente).
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "ScheduleSlot_hold_expires_at_idx"
  ON "ScheduleSlot"("hold_expires_at")
  WHERE "hold_expires_at" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ProfessionalProfile'
      AND column_name = 'location'
      AND udt_name <> 'geography'
  ) THEN
    ALTER TABLE "ProfessionalProfile"
      ALTER COLUMN "location" TYPE geography(Point, 4326)
      USING (
        CASE
          WHEN "location" IS NULL THEN NULL
          ELSE "location"::geography
        END
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProfessionalProfile_location_gix"
  ON "ProfessionalProfile"
  USING GIST ("location")
  WHERE "location" IS NOT NULL;
