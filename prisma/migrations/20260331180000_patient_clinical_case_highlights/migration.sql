-- Tópicos principais do caso (patient-level; JSON validado na aplicação)
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "clinical_case_highlights" JSONB;
