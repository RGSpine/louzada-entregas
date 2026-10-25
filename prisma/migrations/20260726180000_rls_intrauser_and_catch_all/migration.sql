-- ============================================================
-- RLS: IntraUser + catch-all para tabelas public sem RLS.
-- App usa Prisma (owner bypass); protege PostgREST anon/authenticated.
-- ============================================================

ALTER TABLE "IntraUser" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_intrauser" ON "IntraUser";
CREATE POLICY "deny_postgrest_intrauser" ON "IntraUser"
  FOR ALL USING (false) WITH CHECK (false);

-- Catch-all: qualquer tabela public sem RLS recebe deny-all
DO $do$
DECLARE
  r record;
  policy_name text;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity AND tableowner = current_user
  LOOP
    policy_name := 'deny_postgrest_' || lower(r.tablename);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (false) WITH CHECK (false)',
      policy_name,
      r.tablename
    );
  END LOOP;
END $do$;
