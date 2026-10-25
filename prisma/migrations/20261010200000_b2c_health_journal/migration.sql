-- Diário de relato do paciente (Mapa de Saúde).
CREATE TABLE IF NOT EXISTS "HealthJournalEntry" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HealthJournalEntry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthJournalEntry_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "HealthJournalEntry"
      ADD CONSTRAINT "HealthJournalEntry_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "HealthJournalEntry_health_profile_id_created_at_idx"
  ON "HealthJournalEntry"("health_profile_id", "created_at");

ALTER TABLE "HealthJournalEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_healthjournalentry" ON "HealthJournalEntry";
CREATE POLICY "deny_postgrest_healthjournalentry"
  ON "HealthJournalEntry"
  FOR ALL
  USING (false)
  WITH CHECK (false);
