-- B2C Mapa de Saúde: HealthProfile, ClinicalSummary, HealthTask
-- App acessa via Prisma; RLS deny-by-default protege PostgREST.

DO $$
BEGIN
  CREATE TYPE "HealthTaskType" AS ENUM (
    'MEDICATION',
    'EXAM',
    'RETURN_VISIT',
    'WATER',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "HealthProfile" (
  "id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "relationship" VARCHAR(40),
  "date_of_birth" DATE,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HealthProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClinicalSummary" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "original_text" TEXT NOT NULL,
  "translated_explanation" TEXT NOT NULL,
  "references" JSONB,
  "source_type" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HealthTask" (
  "id" TEXT NOT NULL,
  "health_profile_id" TEXT NOT NULL,
  "clinical_summary_id" TEXT,
  "schedule_slot_id" TEXT,
  "title" TEXT NOT NULL,
  "scheduled_time" TIMESTAMPTZ(6),
  "type" "HealthTaskType" NOT NULL DEFAULT 'OTHER',
  "is_completed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HealthTask_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthProfile_patient_id_fkey'
  ) THEN
    ALTER TABLE "HealthProfile"
      ADD CONSTRAINT "HealthProfile_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalSummary_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "ClinicalSummary"
      ADD CONSTRAINT "ClinicalSummary_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthTask_health_profile_id_fkey'
  ) THEN
    ALTER TABLE "HealthTask"
      ADD CONSTRAINT "HealthTask_health_profile_id_fkey"
      FOREIGN KEY ("health_profile_id") REFERENCES "HealthProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthTask_clinical_summary_id_fkey'
  ) THEN
    ALTER TABLE "HealthTask"
      ADD CONSTRAINT "HealthTask_clinical_summary_id_fkey"
      FOREIGN KEY ("clinical_summary_id") REFERENCES "ClinicalSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HealthTask_schedule_slot_id_fkey'
  ) THEN
    ALTER TABLE "HealthTask"
      ADD CONSTRAINT "HealthTask_schedule_slot_id_fkey"
      FOREIGN KEY ("schedule_slot_id") REFERENCES "ScheduleSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "HealthProfile_patient_id_idx" ON "HealthProfile"("patient_id");
CREATE INDEX IF NOT EXISTS "HealthProfile_patient_id_is_primary_idx" ON "HealthProfile"("patient_id", "is_primary");
CREATE INDEX IF NOT EXISTS "ClinicalSummary_health_profile_id_created_at_idx" ON "ClinicalSummary"("health_profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "HealthTask_health_profile_id_is_completed_scheduled_time_idx"
  ON "HealthTask"("health_profile_id", "is_completed", "scheduled_time");
CREATE INDEX IF NOT EXISTS "HealthTask_clinical_summary_id_idx" ON "HealthTask"("clinical_summary_id");
CREATE INDEX IF NOT EXISTS "HealthTask_schedule_slot_id_idx" ON "HealthTask"("schedule_slot_id");

-- RLS deny-by-default (PostgREST); Prisma continua com role dono.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['HealthProfile', 'ClinicalSummary', 'HealthTask']
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
