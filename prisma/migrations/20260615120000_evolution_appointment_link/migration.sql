-- AlterTable
ALTER TABLE "Evolution" ADD COLUMN "appointment_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Evolution_appointment_id_key" ON "Evolution"("appointment_id");

-- CreateIndex
CREATE INDEX "Evolution_appointment_id_idx" ON "Evolution"("appointment_id");

-- AddForeignKey
ALTER TABLE "Evolution" ADD CONSTRAINT "Evolution_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
