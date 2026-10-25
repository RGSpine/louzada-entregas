-- Contatos opcionais da ficha clínica (telefone, pais, acompanhante).
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "father_name" VARCHAR(200);
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "mother_name" VARCHAR(200);
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "companion_name" VARCHAR(200);
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "companion_phone" VARCHAR(40);
