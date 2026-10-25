-- =============================================================================
-- AI.Evolui — PostGIS + Yield Management (B2B2C)
-- Rodar no Supabase SQL Editor (role postgres) ANTES ou DEPOIS do Prisma migrate.
-- Tudo é idempotente (IF NOT EXISTS / exception handlers).
--
-- O Prisma não cria índices GIST nem habilita extensões. Este script cobre:
--   1) CREATE EXTENSION postgis
--   2) DDL das tabelas de marketplace (caso o migrate ainda não tenha rodado)
--   3) Índice espacial GIST em ProfessionalProfile.location
--   4) RLS deny-by-default (PostgREST); o app continua via Prisma.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Enum do slot (marketplace)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE "ScheduleSlotStatus" AS ENUM ('AVAILABLE', 'BOOKED', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Patient: identidade B2C (ficha clínica B2B permanece intacta)
-- ---------------------------------------------------------------------------
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "auth_user_id" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;

CREATE UNIQUE INDEX IF NOT EXISTS "Patient_auth_user_id_key"
  ON "Patient"("auth_user_id");

CREATE INDEX IF NOT EXISTS "Patient_email_idx"
  ON "Patient"("email");

-- ---------------------------------------------------------------------------
-- Specialty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Specialty" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Specialty_slug_key" ON "Specialty"("slug");
CREATE INDEX IF NOT EXISTS "Specialty_active_name_idx" ON "Specialty"("active", "name");

-- ---------------------------------------------------------------------------
-- ProfessionalProfile (geo PostGIS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProfessionalProfile" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "location" geography(Point, 4326),
  "latitude" DECIMAL(10, 7),
  "longitude" DECIMAL(10, 7),
  "city" TEXT,
  "state" VARCHAR(2),
  "neighborhood" TEXT,
  "yield_management_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfessionalProfile_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalProfile_user_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalProfile"
      ADD CONSTRAINT "ProfessionalProfile_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProfessionalProfile_user_id_key"
  ON "ProfessionalProfile"("user_id");

CREATE INDEX IF NOT EXISTS "ProfessionalProfile_yield_management_enabled_idx"
  ON "ProfessionalProfile"("yield_management_enabled");

CREATE INDEX IF NOT EXISTS "ProfessionalProfile_city_state_idx"
  ON "ProfessionalProfile"("city", "state");

-- Índice espacial GIST — Prisma NÃO gera isto.
-- Usar em buscas B2C: ST_DWithin(location, ST_MakePoint($lon, $lat)::geography, $radius_m)
CREATE INDEX IF NOT EXISTS "ProfessionalProfile_location_gix"
  ON "ProfessionalProfile"
  USING GIST ("location")
  WHERE "location" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ProfessionalSpecialty (N:N)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProfessionalSpecialty" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "specialty_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalSpecialty_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalSpecialty_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalSpecialty"
      ADD CONSTRAINT "ProfessionalSpecialty_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessionalSpecialty_specialty_id_fkey'
  ) THEN
    ALTER TABLE "ProfessionalSpecialty"
      ADD CONSTRAINT "ProfessionalSpecialty_specialty_id_fkey"
      FOREIGN KEY ("specialty_id") REFERENCES "Specialty"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProfessionalSpecialty_professional_profile_id_specialty_id_key"
  ON "ProfessionalSpecialty"("professional_profile_id", "specialty_id");

CREATE INDEX IF NOT EXISTS "ProfessionalSpecialty_specialty_id_idx"
  ON "ProfessionalSpecialty"("specialty_id");

-- ---------------------------------------------------------------------------
-- YieldRule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "YieldRule" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "hours_before_trigger" INTEGER NOT NULL,
  "discount_percentage" DECIMAL(5, 2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YieldRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YieldRule_hours_before_trigger_positive"
    CHECK ("hours_before_trigger" > 0),
  CONSTRAINT "YieldRule_discount_percentage_range"
    CHECK ("discount_percentage" >= 0 AND "discount_percentage" <= 100)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'YieldRule_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "YieldRule"
      ADD CONSTRAINT "YieldRule_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "YieldRule_professional_profile_id_is_active_idx"
  ON "YieldRule"("professional_profile_id", "is_active");

CREATE INDEX IF NOT EXISTS "YieldRule_hours_before_trigger_idx"
  ON "YieldRule"("hours_before_trigger");

-- ---------------------------------------------------------------------------
-- ScheduleSlot (lock de overbooking = UNIQUE profissional + datetime)
-- Booking: BEGIN; SELECT … FOR UPDATE; UPDATE … WHERE status = 'AVAILABLE';
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ScheduleSlot" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "patient_id" TEXT,
  "yield_rule_id" TEXT,
  "datetime" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "ScheduleSlotStatus" NOT NULL DEFAULT 'AVAILABLE',
  "base_price" DECIMAL(10, 2) NOT NULL,
  "yield_active" BOOLEAN NOT NULL DEFAULT false,
  "discount_price" DECIMAL(10, 2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleSlot_end_after_start"
    CHECK ("end_at" > "datetime")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleSlot_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ScheduleSlot"
      ADD CONSTRAINT "ScheduleSlot_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleSlot_patient_id_fkey'
  ) THEN
    ALTER TABLE "ScheduleSlot"
      ADD CONSTRAINT "ScheduleSlot_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "Patient"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleSlot_yield_rule_id_fkey'
  ) THEN
    ALTER TABLE "ScheduleSlot"
      ADD CONSTRAINT "ScheduleSlot_yield_rule_id_fkey"
      FOREIGN KEY ("yield_rule_id") REFERENCES "YieldRule"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Impede dois slots no mesmo instante para o mesmo profissional (overbooking).
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleSlot_professional_profile_id_datetime_key"
  ON "ScheduleSlot"("professional_profile_id", "datetime");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_status_datetime_idx"
  ON "ScheduleSlot"("status", "datetime");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_yield_active_status_datetime_idx"
  ON "ScheduleSlot"("yield_active", "status", "datetime");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_patient_id_idx"
  ON "ScheduleSlot"("patient_id");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_professional_profile_id_status_idx"
  ON "ScheduleSlot"("professional_profile_id", "status");

-- ---------------------------------------------------------------------------
-- RLS: deny PostgREST (anon/authenticated). Prisma/owner faz bypass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Specialty',
    'ProfessionalProfile',
    'ProfessionalSpecialty',
    'YieldRule',
    'ScheduleSlot'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "deny_postgrest_%s" ON %I', lower(t), t);
      EXECUTE format(
        'CREATE POLICY "deny_postgrest_%s" ON %I FOR ALL USING (false) WITH CHECK (false)',
        lower(t),
        t
      );
    END IF;
  END LOOP;
END $$;
