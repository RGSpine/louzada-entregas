-- Recurso físico (ServiceSpace) ganha capacidade + tipo.
-- ScheduleSlot passa a poder apontar para a sala da oferta B2C.

DO $$
BEGIN
  CREATE TYPE "ClinicResourceKind" AS ENUM ('ROOM', 'EQUIPMENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ServiceSpace" ADD COLUMN IF NOT EXISTS "capacity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServiceSpace" ADD COLUMN IF NOT EXISTS "kind" "ClinicResourceKind" NOT NULL DEFAULT 'ROOM';

ALTER TABLE "ServiceSpace" DROP CONSTRAINT IF EXISTS "ServiceSpace_capacity_positive";
ALTER TABLE "ServiceSpace"
  ADD CONSTRAINT "ServiceSpace_capacity_positive" CHECK ("capacity" >= 1);

ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS "service_space_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ScheduleSlot_service_space_id_fkey'
  ) THEN
    ALTER TABLE "ScheduleSlot"
      ADD CONSTRAINT "ScheduleSlot_service_space_id_fkey"
      FOREIGN KEY ("service_space_id") REFERENCES "ServiceSpace"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ScheduleSlot_service_space_id_datetime_idx"
  ON "ScheduleSlot"("service_space_id", "datetime");
