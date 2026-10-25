-- Cache diário de Indicações (Ester ← Perfil Clínico)
CREATE TABLE "clinical_recommendations_cache" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "profile_fingerprint" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_recommendations_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_recommendations_cache_user_id_key" ON "clinical_recommendations_cache"("user_id");
CREATE INDEX "clinical_recommendations_cache_expires_at_idx" ON "clinical_recommendations_cache"("expires_at");

ALTER TABLE "clinical_recommendations_cache"
  ADD CONSTRAINT "clinical_recommendations_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_recommendations_cache" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_postgrest_clinical_recommendations_cache" ON "clinical_recommendations_cache";
CREATE POLICY "deny_postgrest_clinical_recommendations_cache" ON "clinical_recommendations_cache"
  FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE "clinical_recommendations_cache" FROM anon, authenticated;
