-- Fase 2 agenda: tipo de consulta, modalidade, valor, notas, vínculo tratamento/plano

CREATE TYPE "AppointmentVisitKind" AS ENUM ('UNIQUE_CONSULTATION', 'RETURN', 'TREATMENT_PLAN');

CREATE TYPE "AppointmentCareSetting" AS ENUM ('IN_PERSON_CLINIC', 'ONLINE', 'HOME_VISIT');

ALTER TABLE "Appointment"
  ADD COLUMN "visit_kind" "AppointmentVisitKind" NOT NULL DEFAULT 'UNIQUE_CONSULTATION',
  ADD COLUMN "care_setting" "AppointmentCareSetting" NOT NULL DEFAULT 'IN_PERSON_CLINIC',
  ADD COLUMN "price_cents" INTEGER,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "patient_service_session_id" TEXT;

CREATE UNIQUE INDEX "Appointment_patient_service_session_id_key" ON "Appointment"("patient_service_session_id");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_patient_service_session_id_fkey"
  FOREIGN KEY ("patient_service_session_id") REFERENCES "PatientServiceSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
