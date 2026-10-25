-- Job assíncrono do Agente Financeiro (áudio longo → fila + cron evolution-jobs).
-- Reutiliza enum EvolutionProcessingJobStatus.

CREATE TABLE "FinanceAgentJob" (
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

    CONSTRAINT "FinanceAgentJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinanceAgentJob_user_id_status_idx" ON "FinanceAgentJob"("user_id", "status");

CREATE INDEX "FinanceAgentJob_created_at_idx" ON "FinanceAgentJob"("created_at");

ALTER TABLE "FinanceAgentJob" ADD CONSTRAINT "FinanceAgentJob_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceAgentJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_postgrest_financeagentjob" ON "FinanceAgentJob";

CREATE POLICY "deny_postgrest_financeagentjob" ON "FinanceAgentJob" FOR ALL USING (false) WITH CHECK (false);
