-- Medicamentos & Suplementos estruturados na evolução (JSON versionado em evolution-artifacts.ts)
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "medicationsAndSupplements" JSONB;
