-- Data de nascimento na ficha clínica (fonte da idade automática).
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;
