-- CreateEnum
CREATE TYPE "EvolutionProcessingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "EvolutionProcessingJob" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "EvolutionProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "request_data" JSONB NOT NULL,
    "result_data" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvolutionProcessingJob_user_id_status_idx" ON "EvolutionProcessingJob"("user_id", "status");

-- CreateIndex
CREATE INDEX "EvolutionProcessingJob_created_at_idx" ON "EvolutionProcessingJob"("created_at");

-- AddForeignKey
ALTER TABLE "EvolutionProcessingJob" ADD CONSTRAINT "EvolutionProcessingJob_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
