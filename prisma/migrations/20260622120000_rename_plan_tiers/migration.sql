-- Refatoração de nomenclatura dos planos (valores legados → novos tiers).
-- Limites e lógica de negócio permanecem os mesmos.

ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'BASICO';

UPDATE "User" SET "plan" = 'BASICO' WHERE "plan" = 'FREE';
UPDATE "User" SET "plan" = 'PROFISSIONAL' WHERE "plan" = 'STARTER';
UPDATE "User" SET "plan" = 'PREMIUM' WHERE "plan" = 'PRO';
UPDATE "User" SET "plan" = 'CONSULTORIO' WHERE "plan" = 'STARTER_CLINICA';
UPDATE "User" SET "plan" = 'CLINICA' WHERE "plan" = 'PRO_CLINICA';
