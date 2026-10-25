-- Panorama geral por perfil + estrutura de consulta no ClinicalSummary.
ALTER TABLE "HealthProfile"
  ADD COLUMN IF NOT EXISTS "health_panorama" TEXT;

ALTER TABLE "ClinicalSummary"
  ADD COLUMN IF NOT EXISTS "structured" JSONB;
