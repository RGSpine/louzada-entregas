-- Suite diária Consultório Financeiro (histórico de corridas).
CREATE TABLE IF NOT EXISTS "FinanceDailyRun" (
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

    CONSTRAINT "FinanceDailyRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinanceDailyRun_started_at_idx" ON "FinanceDailyRun"("started_at" DESC);
