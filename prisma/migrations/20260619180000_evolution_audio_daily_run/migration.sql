-- CreateTable
CREATE TABLE "EvolutionAudioDailyRun" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skip_reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'cron',
    "results" JSONB NOT NULL DEFAULT '[]',
    "env_report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionAudioDailyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvolutionAudioDailyRun_started_at_idx" ON "EvolutionAudioDailyRun"("started_at" DESC);
