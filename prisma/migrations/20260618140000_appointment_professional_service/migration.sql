-- Serviço do catálogo vinculado à marcação (modelo unificado: todo atendimento = serviço)
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "professional_service_id" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_professional_service_id_idx"
  ON "Appointment"("professional_service_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_professional_service_id_fkey'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT "Appointment_professional_service_id_fkey"
      FOREIGN KEY ("professional_service_id") REFERENCES "ProfessionalService"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
