-- Preferências opcionais de entrega do PDF da evolução (download / e-mail).
-- Salvamento no paciente permanece sempre obrigatório no fluxo de geração.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "auto_download_new_evolution" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_new_evolution" BOOLEAN NOT NULL DEFAULT true;
