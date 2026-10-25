-- Permissão por Intra User: MEMBER pode (ou não) gerir serviços/sessões na ficha do paciente.
ALTER TABLE "IntraUser"
  ADD COLUMN IF NOT EXISTS "can_manage_patient_services" BOOLEAN NOT NULL DEFAULT true;
