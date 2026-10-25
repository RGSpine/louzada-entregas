-- Metadados do assistente B2C (citações PubMed/Perplexity, flags de evidência).
ALTER TABLE "PatientHealthChatMessage"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

