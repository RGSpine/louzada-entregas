-- AlterTable (PostgreSQL 11+: ADD COLUMN IF NOT EXISTS)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "auth_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_auth_user_id_key" ON "User"("auth_user_id");

-- Backfill: usuários cujo id já é o UUID do Supabase Auth (formato UUID v4)
-- Opcional: rode após deploy para preencher auth_user_id onde id = auth id
-- UPDATE "User" SET auth_user_id = id WHERE auth_user_id IS NULL AND id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
