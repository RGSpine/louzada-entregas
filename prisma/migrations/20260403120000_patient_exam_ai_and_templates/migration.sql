-- CreateEnum
CREATE TYPE "PatientExamSource" AS ENUM ('MANUAL_UPLOAD', 'AI_GENERATED');

-- AlterTable
ALTER TABLE "PatientExam" ADD COLUMN "source" "PatientExamSource" NOT NULL DEFAULT 'MANUAL_UPLOAD';
ALTER TABLE "PatientExam" ADD COLUMN "document_type" TEXT;

-- CreateIndex
CREATE INDEX "PatientExam_source_idx" ON "PatientExam"("source");

-- CreateTable
CREATE TABLE "UserDocumentTemplate" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "label" TEXT,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "extracted_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDocumentTemplate_user_id_idx" ON "UserDocumentTemplate"("user_id");
CREATE INDEX "UserDocumentTemplate_user_id_document_type_idx" ON "UserDocumentTemplate"("user_id", "document_type");

-- AddForeignKey
ALTER TABLE "UserDocumentTemplate" ADD CONSTRAINT "UserDocumentTemplate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
