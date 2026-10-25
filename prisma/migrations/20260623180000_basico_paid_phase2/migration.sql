-- Fase 2: plano Básico pago + migração base legada gratuita

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "basico_checkout_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legacy_free_sunset_notice_sent_at" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legacy_free_sunset_ends_at" TIMESTAMPTZ;
