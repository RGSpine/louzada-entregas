-- ============================================================
-- MIGRAÇÃO: Habilitar Row Level Security (RLS) nas tabelas
-- sensíveis do AI.Evolui (conformidade LGPD).
--
-- IMPORTANTE:
--   • O Prisma conecta como "postgres" (superuser) → bypassa RLS
--     por padrão. Estas políticas protegem acessos via PostgREST
--     (Supabase REST API / anon / authenticated keys).
--   • Políticas usam JOIN com "User".auth_user_id para mapear
--     o UUID do Supabase Auth (auth.uid()) ao CUID do Prisma.
--   • DROP POLICY IF EXISTS antes de cada CREATE torna a migração
--     segura em retry após falha parcial ou estado sujo na BD.
-- ============================================================

-- Compatibilidade para shadow DB/local sem Supabase Auth:
-- garante schema `auth` e função `auth.uid()` antes das policies.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth'
      AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $func$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $func$;
  END IF;
END $do$;

-- ------------------------------------------------------------
-- 1. PATIENT
-- ------------------------------------------------------------
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_select_own" ON "Patient";
CREATE POLICY "patient_select_own" ON "Patient"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Patient"."userId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patient_insert_own" ON "Patient";
CREATE POLICY "patient_insert_own" ON "Patient"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Patient"."userId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patient_update_own" ON "Patient";
CREATE POLICY "patient_update_own" ON "Patient"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Patient"."userId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patient_delete_own" ON "Patient";
CREATE POLICY "patient_delete_own" ON "Patient"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Patient"."userId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

-- ------------------------------------------------------------
-- 2. EVOLUTION
-- ------------------------------------------------------------
ALTER TABLE "Evolution" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evolution_select_own" ON "Evolution";
CREATE POLICY "evolution_select_own" ON "Evolution"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "Evolution"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "evolution_insert_own" ON "Evolution";
CREATE POLICY "evolution_insert_own" ON "Evolution"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "Evolution"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "evolution_update_own" ON "Evolution";
CREATE POLICY "evolution_update_own" ON "Evolution"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "Evolution"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "evolution_delete_own" ON "Evolution";
CREATE POLICY "evolution_delete_own" ON "Evolution"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "Evolution"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

-- ------------------------------------------------------------
-- 3. PATIENTMETRIC
-- ------------------------------------------------------------
ALTER TABLE "PatientMetric" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patientmetric_select_own" ON "PatientMetric";
CREATE POLICY "patientmetric_select_own" ON "PatientMetric"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientMetric"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientmetric_insert_own" ON "PatientMetric";
CREATE POLICY "patientmetric_insert_own" ON "PatientMetric"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientMetric"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientmetric_update_own" ON "PatientMetric";
CREATE POLICY "patientmetric_update_own" ON "PatientMetric"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientMetric"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientmetric_delete_own" ON "PatientMetric";
CREATE POLICY "patientmetric_delete_own" ON "PatientMetric"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientMetric"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

-- ------------------------------------------------------------
-- 4. PATIENTEXAM
-- ------------------------------------------------------------
ALTER TABLE "PatientExam" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patientexam_select_own" ON "PatientExam";
CREATE POLICY "patientexam_select_own" ON "PatientExam"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientExam"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientexam_insert_own" ON "PatientExam";
CREATE POLICY "patientexam_insert_own" ON "PatientExam"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientExam"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientexam_update_own" ON "PatientExam";
CREATE POLICY "patientexam_update_own" ON "PatientExam"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientExam"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "patientexam_delete_own" ON "PatientExam";
CREATE POLICY "patientexam_delete_own" ON "PatientExam"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "Patient" p
      JOIN "User" u ON u.id = p."userId"
      WHERE p.id = "PatientExam"."patientId"
        AND u.auth_user_id = auth.uid()::text
    )
  );

-- ------------------------------------------------------------
-- 5. USER — proteger dados de perfil
-- ------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_select_own" ON "User";
CREATE POLICY "user_select_own" ON "User"
  FOR SELECT
  USING (auth_user_id = auth.uid()::text);

DROP POLICY IF EXISTS "user_update_own" ON "User";
CREATE POLICY "user_update_own" ON "User"
  FOR UPDATE
  USING (auth_user_id = auth.uid()::text);

-- Inserção de novos usuários é exclusiva do service_role (NextAuth/Admin)
-- (sem policy INSERT = bloqueia via PostgREST; Prisma/postgres bypassa)
