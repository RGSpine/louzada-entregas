-- Stub mínimo do schema `auth` para ambientes sem Supabase Auth (ex.: shadow DB do
-- Prisma Migrate, Postgres local). Em produção Supabase o schema `auth` já existe —
-- este bloco não altera nada.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $func$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $func$;
  END IF;
END $do$;
