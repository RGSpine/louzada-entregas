-- Projeção dos horários livres da agenda para a busca da vitrine.
-- Não guarda nome, telefone nem prontuário do paciente.

CREATE TABLE IF NOT EXISTS "ShowcaseAgendaOpening" (
  "id" TEXT NOT NULL,
  "professional_profile_id" TEXT NOT NULL,
  "start_at" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ShowcaseAgendaOpening_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShowcaseAgendaOpening_professional_profile_id_fkey'
  ) THEN
    ALTER TABLE "ShowcaseAgendaOpening"
      ADD CONSTRAINT "ShowcaseAgendaOpening_professional_profile_id_fkey"
      FOREIGN KEY ("professional_profile_id") REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ShowcaseAgendaOpening_professional_profile_id_start_at_idx"
  ON "ShowcaseAgendaOpening"("professional_profile_id", "start_at");
CREATE INDEX IF NOT EXISTS "ShowcaseAgendaOpening_start_at_end_at_idx"
  ON "ShowcaseAgendaOpening"("start_at", "end_at");

ALTER TABLE "ShowcaseAgendaOpening" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_showcaseagendaopening" ON "ShowcaseAgendaOpening";
CREATE POLICY "deny_postgrest_showcaseagendaopening"
  ON "ShowcaseAgendaOpening"
  FOR ALL
  USING (false)
  WITH CHECK (false);
