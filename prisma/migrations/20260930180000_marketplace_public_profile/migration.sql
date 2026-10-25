-- Campos públicos da vitrine B2C (perfil marketplace Premium+).

ALTER TABLE "ProfessionalProfile"
  ADD COLUMN IF NOT EXISTS "public_bio" TEXT,
  ADD COLUMN IF NOT EXISTS "public_photo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "maps_url" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "public_headline" VARCHAR(160);
