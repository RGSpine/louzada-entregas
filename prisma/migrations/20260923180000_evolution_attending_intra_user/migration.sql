-- Intra User que registrou a evolução (painel admin do Consultório Financeiro).
ALTER TABLE "Evolution"
  ADD COLUMN IF NOT EXISTS "attending_intra_user_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Evolution_attending_intra_user_id_fkey'
  ) THEN
    ALTER TABLE "Evolution"
      ADD CONSTRAINT "Evolution_attending_intra_user_id_fkey"
      FOREIGN KEY ("attending_intra_user_id") REFERENCES "IntraUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Evolution_attending_intra_user_id_idx"
  ON "Evolution"("attending_intra_user_id");
