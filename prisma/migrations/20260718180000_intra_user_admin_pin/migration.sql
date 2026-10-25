-- PIN de administrador (Opção B): só perfis ADMIN usam PIN para ativação.
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "pin_hash" TEXT;
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "pin_updated_at" TIMESTAMP(3);
