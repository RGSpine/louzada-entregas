-- Assistente de saúde B2C (1:1 por HealthProfile)

CREATE TABLE IF NOT EXISTS "PatientHealthChatSession" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientHealthChatSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PatientHealthChatSession_health_profile_id_key"
  ON "PatientHealthChatSession"("health_profile_id");

CREATE TABLE IF NOT EXISTS "PatientHealthChatMessage" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientHealthChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PatientHealthChatMessage_session_id_created_at_idx"
  ON "PatientHealthChatMessage"("session_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PatientHealthChatSession_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "PatientHealthChatSession"
      ADD CONSTRAINT "PatientHealthChatSession_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PatientHealthChatMessage_session_id_fkey'
  ) THEN
    ALTER TABLE "PatientHealthChatMessage"
      ADD CONSTRAINT "PatientHealthChatMessage_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "PatientHealthChatSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PatientHealthChatSession', 'PatientHealthChatMessage']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'deny_postgrest_' || lower(t), t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (false) WITH CHECK (false)',
      'deny_postgrest_' || lower(t),
      t
    );
  END LOOP;
END $$;
