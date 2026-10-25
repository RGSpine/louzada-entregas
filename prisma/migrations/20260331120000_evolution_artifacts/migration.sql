-- Action items (profissional) e handout (paciente) por evolução
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "professionalActions" JSONB;
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "patientHandout" JSONB;
