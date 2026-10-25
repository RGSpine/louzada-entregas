-- ============================================================
-- RLS hardening: fecha gaps PostgREST (anon/authenticated).
-- Prisma/postgres (owner) não é afetado.
-- ============================================================

-- P0: User — deny-all (evita escalação de plan/role via PATCH REST)
DROP POLICY IF EXISTS "user_select_own" ON "User";
DROP POLICY IF EXISTS "user_update_own" ON "User";
DROP POLICY IF EXISTS "deny_postgrest_user" ON "User";
CREATE POLICY "deny_postgrest_user" ON "User"
  FOR ALL USING (false) WITH CHECK (false);

-- P0: _prisma_migrations — bloqueio total + revoke grants
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "deny_postgrest_prisma_migrations" ON public._prisma_migrations';
    EXECUTE $policy$
      CREATE POLICY "deny_postgrest_prisma_migrations" ON public._prisma_migrations
        FOR ALL USING (false) WITH CHECK (false)
    $policy$;
    REVOKE ALL ON public._prisma_migrations FROM anon, authenticated;
  END IF;
END $do$;

-- P0/P1: deny-all em tabelas criadas sem RLS
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'user_access_session',
    'push_subscription',
    'push_notification_delivery',
    'patient_chat_session',
    'patient_chat_message',
    'EvolutionAudioDailyRun',
    'FiscalDocument',
    'FiscalIssuerProfile'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "deny_postgrest_%s" ON %I', lower(replace(t, '"', '')), t);
      EXECUTE format(
        'CREATE POLICY "deny_postgrest_%s" ON %I FOR ALL USING (false) WITH CHECK (false)',
        lower(replace(t, '"', '')),
        t
      );
    END IF;
  END LOOP;
END $do$;

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
