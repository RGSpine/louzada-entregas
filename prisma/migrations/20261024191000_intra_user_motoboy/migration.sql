-- Motoboy é um IntraUser marcado, separado das operadoras.

ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "is_motoboy" BOOLEAN NOT NULL DEFAULT false;
