-- Enums
CREATE TYPE "PatientServicePurchaseType" AS ENUM ('SINGLE', 'PACKAGE');

CREATE TYPE "PatientServiceSessionStatus" AS ENUM ('PENDING', 'CONSUMED', 'WAIVED', 'CANCELLED');

CREATE TYPE "FinancialTransactionKind" AS ENUM ('INCOME', 'EXPENSE');

CREATE TYPE "FinancialTransactionMethod" AS ENUM ('CASH', 'PIX', 'CARD', 'TRANSFER', 'OTHER');

CREATE TYPE "SessionConsumptionSource" AS ENUM ('APPOINTMENT_COMPLETED', 'EVOLUTION_RECORDED', 'MANUAL');

-- Catálogo de serviços
CREATE TABLE "ProfessionalService" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_price_cents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProfessionalService_user_id_idx" ON "ProfessionalService"("user_id");

CREATE INDEX "ProfessionalService_user_id_active_idx" ON "ProfessionalService"("user_id", "active");

-- Compras por paciente
CREATE TABLE "PatientServicePurchase" (
    "id" TEXT NOT NULL,
    "professional_user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "professional_service_id" TEXT NOT NULL,
    "type" "PatientServicePurchaseType" NOT NULL,
    "session_count_total" INTEGER NOT NULL,
    "agreed_price_cents" INTEGER NOT NULL,
    "purchased_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientServicePurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientServicePurchase_professional_user_id_purchased_at_idx" ON "PatientServicePurchase"("professional_user_id", "purchased_at");

CREATE INDEX "PatientServicePurchase_patient_id_idx" ON "PatientServicePurchase"("patient_id");

-- Sessões do pacote / avulsa
CREATE TABLE "PatientServiceSession" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PatientServiceSessionStatus" NOT NULL DEFAULT 'PENDING',
    "consumed_at" TIMESTAMPTZ(6),
    "allocated_price_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientServiceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientServiceSession_purchase_id_sequence_key" ON "PatientServiceSession"("purchase_id", "sequence");

CREATE INDEX "PatientServiceSession_purchase_id_status_idx" ON "PatientServiceSession"("purchase_id", "status");

-- Eventos de consumo (idempotência agenda/evolução)
CREATE TABLE "SessionConsumptionEvent" (
    "id" TEXT NOT NULL,
    "professional_user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "source" "SessionConsumptionSource" NOT NULL,
    "consumed_at_anchor" TIMESTAMPTZ(6) NOT NULL,
    "calendar_day_local" TEXT NOT NULL,
    "appointment_id" TEXT,
    "evolution_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionConsumptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionConsumptionEvent_appointment_id_key" ON "SessionConsumptionEvent"("appointment_id");

CREATE UNIQUE INDEX "SessionConsumptionEvent_evolution_id_key" ON "SessionConsumptionEvent"("evolution_id");

CREATE INDEX "SessionConsumptionEvent_professional_user_id_patient_id_calendar_day_local_idx" ON "SessionConsumptionEvent"("professional_user_id", "patient_id", "calendar_day_local");

CREATE INDEX "SessionConsumptionEvent_session_id_idx" ON "SessionConsumptionEvent"("session_id");

-- Transações financeiras
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "professional_user_id" TEXT NOT NULL,
    "kind" "FinancialTransactionKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "method" "FinancialTransactionMethod" NOT NULL,
    "description" TEXT,
    "patient_id" TEXT,
    "purchase_id" TEXT,
    "patient_service_session_id" TEXT,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialTransaction_patient_service_session_id_key" ON "FinancialTransaction"("patient_service_session_id");

CREATE INDEX "FinancialTransaction_professional_user_id_occurred_at_idx" ON "FinancialTransaction"("professional_user_id", "occurred_at");

CREATE INDEX "FinancialTransaction_patient_id_occurred_at_idx" ON "FinancialTransaction"("patient_id", "occurred_at");

-- FKs
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientServicePurchase" ADD CONSTRAINT "PatientServicePurchase_professional_user_id_fkey" FOREIGN KEY ("professional_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientServicePurchase" ADD CONSTRAINT "PatientServicePurchase_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientServicePurchase" ADD CONSTRAINT "PatientServicePurchase_professional_service_id_fkey" FOREIGN KEY ("professional_service_id") REFERENCES "ProfessionalService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientServiceSession" ADD CONSTRAINT "PatientServiceSession_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "PatientServicePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionConsumptionEvent" ADD CONSTRAINT "SessionConsumptionEvent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "PatientServiceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionConsumptionEvent" ADD CONSTRAINT "SessionConsumptionEvent_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionConsumptionEvent" ADD CONSTRAINT "SessionConsumptionEvent_evolution_id_fkey" FOREIGN KEY ("evolution_id") REFERENCES "Evolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_professional_user_id_fkey" FOREIGN KEY ("professional_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "PatientServicePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_patient_service_session_id_fkey" FOREIGN KEY ("patient_service_session_id") REFERENCES "PatientServiceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
