-- Link de uso único para trocar o PIN do administrador principal.
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "pin_reset_token_hash" TEXT;
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "pin_reset_expires_at" TIMESTAMPTZ(6);
