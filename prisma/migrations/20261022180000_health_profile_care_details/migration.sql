-- Dados de cuidado informados pelo paciente (titular e dependentes).
ALTER TABLE "HealthProfile" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(40);
ALTER TABLE "HealthProfile" ADD COLUMN IF NOT EXISTS "insurance_name" VARCHAR(160);
ALTER TABLE "HealthProfile" ADD COLUMN IF NOT EXISTS "treatments" TEXT;
ALTER TABLE "HealthProfile" ADD COLUMN IF NOT EXISTS "profile_notes" TEXT;
