-- Fase Multi-tenant: Intra Users (sub-usuários) para planos Consultório/Clínica.
-- Mantém a credencial única do Tenant (User); adiciona perfis internos com
-- segregação de dados (owner_id/is_shared) e RBAC (ADMIN/MEMBER).

-- 1. Enum de permissão
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntraUserRole') THEN
    CREATE TYPE "IntraUserRole" AS ENUM ('ADMIN', 'MEMBER');
  END IF;
END
$$;

-- 2. Tabela IntraUser
CREATE TABLE IF NOT EXISTS "IntraUser" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "color"      VARCHAR(7) NOT NULL DEFAULT '#2563EB',
  "role"       "IntraUserRole" NOT NULL DEFAULT 'MEMBER',
  "is_owner"   BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntraUser_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IntraUser_user_id_idx" ON "IntraUser"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IntraUser_user_id_fkey'
  ) THEN
    ALTER TABLE "IntraUser"
      ADD CONSTRAINT "IntraUser_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 3. Colunas de segregação em Patient
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "is_shared" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Patient_owner_id_idx" ON "Patient"("owner_id");
CREATE INDEX IF NOT EXISTS "Patient_userId_owner_id_idx" ON "Patient"("userId", "owner_id");

-- 4. Coluna de profissional que atende em Appointment
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "intra_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_intra_user_id_idx" ON "Appointment"("intra_user_id");

-- 5. FKs para IntraUser (SET NULL para não apagar histórico ao remover um profissional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Patient_owner_id_fkey'
  ) THEN
    ALTER TABLE "Patient"
      ADD CONSTRAINT "Patient_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "IntraUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_intra_user_id_fkey'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT "Appointment_intra_user_id_fkey"
      FOREIGN KEY ("intra_user_id") REFERENCES "IntraUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 6. Backfill: cria 1 Intra User owner (ADMIN) por conta existente e atribui
-- pacientes legados a ele. Sharing permanece explícito (is_shared = false):
-- a equipe só vê o paciente após toggle intencional no prontuário.
INSERT INTO "IntraUser" ("id", "user_id", "name", "color", "role", "is_owner", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  u."id",
  COALESCE(NULLIF(btrim(u."name"), ''), 'Titular'),
  '#2563EB',
  'ADMIN',
  true,
  now(),
  now()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "IntraUser" iu WHERE iu."user_id" = u."id" AND iu."is_owner" = true
);

UPDATE "Patient" p
SET "owner_id" = iu."id",
    "is_shared" = false
FROM "IntraUser" iu
WHERE iu."is_owner" = true
  AND iu."user_id" = p."userId"
  AND p."owner_id" IS NULL;

UPDATE "Appointment" a
SET "intra_user_id" = iu."id"
FROM "IntraUser" iu
WHERE iu."is_owner" = true
  AND iu."user_id" = a."professional_user_id"
  AND a."intra_user_id" IS NULL;
