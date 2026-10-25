-- Cadastro inicial da equipe, uma vez por conta.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "team_setup_completed_at" TIMESTAMPTZ(6);

-- Contas que já existem não passam de novo pelo cadastro inicial.
UPDATE "User"
SET "team_setup_completed_at" = NOW()
WHERE "team_setup_completed_at" IS NULL;

-- O administrador principal pode ter o nome ajustado uma vez.
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "name_revision" INTEGER NOT NULL DEFAULT 0;
