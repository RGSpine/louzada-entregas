-- Entregador pode ficar inativo sem perder o nome nas marcações já feitas.

ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
