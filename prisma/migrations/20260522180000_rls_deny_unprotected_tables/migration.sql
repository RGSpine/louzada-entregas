-- ============================================================
-- RLS deny-by-default em tabelas sem políticas tenant-aware.
-- Protege PostgREST (anon/authenticated); Prisma/postgres com BYPASSRLS
-- não é afetado.
-- ============================================================

DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Appointment',
    'EvolutionProcessingJob',
    'OfficeFinanceExtractionJob',
    'UserGoal',
    'UserDocumentTemplate',
    'RemarketingContact',
    'ProfessionalService',
    'PatientServicePurchase',
    'PatientServiceSession',
    'SessionConsumptionEvent',
    'FinancialTransaction',
    'Account',
    'Session',
    'VerificationToken'
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
END $do$;
