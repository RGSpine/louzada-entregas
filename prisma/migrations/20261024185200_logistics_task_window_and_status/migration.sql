-- Janela de horário, URL do áudio, nota de rota e status do painel.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LogisticsTaskStatus' AND e.enumlabel = 'PENDING'
  ) THEN
    ALTER TYPE "LogisticsTaskStatus" RENAME VALUE 'PENDING' TO 'PENDENTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LogisticsTaskStatus' AND e.enumlabel = 'DONE'
  ) THEN
    ALTER TYPE "LogisticsTaskStatus" RENAME VALUE 'DONE' TO 'CONCLUIDO';
  END IF;
END
$$;

ALTER TYPE "LogisticsTaskStatus" ADD VALUE 'EM_ROTA';
ALTER TYPE "LogisticsTaskStatus" ADD VALUE 'CANCELADO';

ALTER TABLE "LogisticsTask" ALTER COLUMN "status" SET DEFAULT 'PENDENTE';

ALTER TABLE "LogisticsTask" ADD COLUMN IF NOT EXISTS "time_window_start" VARCHAR(5);

ALTER TABLE "LogisticsIntake" ADD COLUMN IF NOT EXISTS "audio_source_url" TEXT;

ALTER TABLE "DentistClient" ADD COLUMN IF NOT EXISTS "route_note" TEXT;
