-- CreateEnum
CREATE TYPE "EvolutionSource" AS ENUM ('NATIVE', 'IMPORTED');

-- AlterTable User: contador mensal de importações de histórico
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "history_import_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "history_import_count_reset_at" TIMESTAMP(3);

-- AlterTable Evolution: proveniência de importação
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "source" "EvolutionSource" NOT NULL DEFAULT 'NATIVE';
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "import_batch_id" TEXT;
ALTER TABLE "Evolution" ADD COLUMN IF NOT EXISTS "imported_from" VARCHAR(32);

CREATE INDEX IF NOT EXISTS "Evolution_import_batch_id_idx" ON "Evolution"("import_batch_id");
CREATE INDEX IF NOT EXISTS "Evolution_source_idx" ON "Evolution"("source");
