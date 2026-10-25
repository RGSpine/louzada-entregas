-- IP do último login/claim no dispositivo (planos individuais: último IP vence).
ALTER TABLE "user_access_session" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
