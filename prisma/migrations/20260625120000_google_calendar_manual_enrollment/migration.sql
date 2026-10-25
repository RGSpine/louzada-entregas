-- Pedido manual de integração Google Agenda (período de testes pré-verificação OAuth)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_calendar_manual_email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_calendar_manual_requested_at" TIMESTAMPTZ(6);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "google_calendar_manual_approved_at" TIMESTAMPTZ(6);
