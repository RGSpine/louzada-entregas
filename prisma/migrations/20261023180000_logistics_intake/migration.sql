-- Lote de voz do laboratório: dentistas, áudio revisável e tarefas de coleta/entrega.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogisticsTaskType') THEN
    CREATE TYPE "LogisticsTaskType" AS ENUM ('ENTREGA', 'COLETA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogisticsTaskStatus') THEN
    CREATE TYPE "LogisticsTaskStatus" AS ENUM ('PENDING', 'DONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogisticsIntakeStatus') THEN
    CREATE TYPE "LogisticsIntakeStatus" AS ENUM ('DRAFT', 'CONFIRMED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "DentistClient" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "name"        VARCHAR(200) NOT NULL,
  "clinic_name" VARCHAR(200),
  "address"     TEXT NOT NULL,
  "phone"       VARCHAR(40),
  "aliases"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DentistClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LogisticsIntake" (
  "id"                       TEXT NOT NULL,
  "user_id"                  TEXT NOT NULL,
  "created_by_intra_user_id" TEXT,
  "transcript"               TEXT NOT NULL,
  "tasks_json"               JSONB NOT NULL,
  "status"                   "LogisticsIntakeStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LogisticsIntake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LogisticsTask" (
  "id"                    TEXT NOT NULL,
  "user_id"               TEXT NOT NULL,
  "intake_id"             TEXT NOT NULL,
  "type"                  "LogisticsTaskType" NOT NULL,
  "dentist_client_id"     TEXT,
  "raw_client_name"       VARCHAR(200) NOT NULL,
  "work_description"      TEXT,
  "target_date"           DATE,
  "time_window_end"       VARCHAR(5),
  "status"                "LogisticsTaskStatus" NOT NULL DEFAULT 'PENDING',
  "motoboy_intra_user_id" TEXT,
  "completed_at"          TIMESTAMPTZ(6),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LogisticsTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DentistClient_user_id_name_idx"
  ON "DentistClient"("user_id", "name");
CREATE INDEX IF NOT EXISTS "DentistClient_aliases_idx"
  ON "DentistClient" USING GIN ("aliases");

CREATE INDEX IF NOT EXISTS "LogisticsIntake_user_id_created_at_idx"
  ON "LogisticsIntake"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "LogisticsIntake_created_by_intra_user_id_idx"
  ON "LogisticsIntake"("created_by_intra_user_id");

CREATE INDEX IF NOT EXISTS "LogisticsTask_user_id_target_date_status_idx"
  ON "LogisticsTask"("user_id", "target_date", "status");
CREATE INDEX IF NOT EXISTS "LogisticsTask_intake_id_idx"
  ON "LogisticsTask"("intake_id");
CREATE INDEX IF NOT EXISTS "LogisticsTask_dentist_client_id_idx"
  ON "LogisticsTask"("dentist_client_id");
CREATE INDEX IF NOT EXISTS "LogisticsTask_motoboy_intra_user_id_idx"
  ON "LogisticsTask"("motoboy_intra_user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DentistClient_user_id_fkey') THEN
    ALTER TABLE "DentistClient"
      ADD CONSTRAINT "DentistClient_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsIntake_user_id_fkey') THEN
    ALTER TABLE "LogisticsIntake"
      ADD CONSTRAINT "LogisticsIntake_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsIntake_created_by_intra_user_id_fkey') THEN
    ALTER TABLE "LogisticsIntake"
      ADD CONSTRAINT "LogisticsIntake_created_by_intra_user_id_fkey"
      FOREIGN KEY ("created_by_intra_user_id") REFERENCES "IntraUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsTask_user_id_fkey') THEN
    ALTER TABLE "LogisticsTask"
      ADD CONSTRAINT "LogisticsTask_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsTask_intake_id_fkey') THEN
    ALTER TABLE "LogisticsTask"
      ADD CONSTRAINT "LogisticsTask_intake_id_fkey"
      FOREIGN KEY ("intake_id") REFERENCES "LogisticsIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsTask_dentist_client_id_fkey') THEN
    ALTER TABLE "LogisticsTask"
      ADD CONSTRAINT "LogisticsTask_dentist_client_id_fkey"
      FOREIGN KEY ("dentist_client_id") REFERENCES "DentistClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LogisticsTask_motoboy_intra_user_id_fkey') THEN
    ALTER TABLE "LogisticsTask"
      ADD CONSTRAINT "LogisticsTask_motoboy_intra_user_id_fkey"
      FOREIGN KEY ("motoboy_intra_user_id") REFERENCES "IntraUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
