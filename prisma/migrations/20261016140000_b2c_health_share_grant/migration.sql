CREATE TABLE IF NOT EXISTS "HealthShareGrant" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HealthShareGrant_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthShareGrant_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "HealthShareGrant"
      ADD CONSTRAINT "HealthShareGrant_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthShareGrant_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "HealthShareGrant"
      ADD CONSTRAINT "HealthShareGrant_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "HealthShareGrant_health_profile_id_professional_profile_id_key"
  ON "HealthShareGrant"("health_profile_id", "professional_profile_id");
CREATE INDEX IF NOT EXISTS "HealthShareGrant_professional_profile_id_idx"
  ON "HealthShareGrant"("professional_profile_id");

ALTER TABLE "HealthShareGrant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_healthsharegrant" ON "HealthShareGrant";
CREATE POLICY "deny_postgrest_healthsharegrant"
  ON "HealthShareGrant"
  FOR ALL
  USING (false)
  WITH CHECK (false);
