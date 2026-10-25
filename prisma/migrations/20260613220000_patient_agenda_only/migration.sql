-- Pacientes placeholder da importação Google Agenda (não clínicos)
ALTER TABLE "Patient" ADD COLUMN "agenda_only" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Patient_userId_agenda_only_idx" ON "Patient"("userId", "agenda_only");
