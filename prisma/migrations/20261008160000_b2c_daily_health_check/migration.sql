-- Check-in diário B2C (manual) + campos opcionais de relógio/app.
CREATE TABLE IF NOT EXISTS "DailyHealthCheck" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "water_ml" INTEGER,
  "sleep_minutes" INTEGER,
  "sleep_quality" SMALLINT,
  "urine_color" VARCHAR(20),
  "bristol_type" SMALLINT,
  "stool_color" VARCHAR(20),
  "activity_minutes" INTEGER,
  "wearable_source" VARCHAR(40),
  "wearable_steps" INTEGER,
  "wearable_sleep_minutes" INTEGER,
  "wearable_active_minutes" INTEGER,
  "wearable_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyHealthCheck_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyHealthCheck_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "DailyHealthCheck"
      ADD CONSTRAINT "DailyHealthCheck_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DailyHealthCheck_health_profile_id_day_key"
  ON "DailyHealthCheck"("health_profile_id", "day");
CREATE INDEX IF NOT EXISTS "DailyHealthCheck_health_profile_id_day_idx"
  ON "DailyHealthCheck"("health_profile_id", "day");

ALTER TABLE "DailyHealthCheck" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_dailyhealthcheck" ON "DailyHealthCheck";
CREATE POLICY "deny_postgrest_dailyhealthcheck"
  ON "DailyHealthCheck"
  FOR ALL
  USING (false)
  WITH CHECK (false);
