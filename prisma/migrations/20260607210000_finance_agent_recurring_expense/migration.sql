-- ============================================================
-- Agente Financeiro: despesas fixas recorrentes + classificação
-- de despesas (fixa/flutuante), categoria, proveniência e
-- materialização idempotente por período.
-- ============================================================

-- Enums novos
CREATE TYPE "ExpenseNature" AS ENUM ('FIXED', 'VARIABLE');

CREATE TYPE "FinancialEntrySource" AS ENUM ('MANUAL', 'AUDIO', 'PHOTO', 'AGENT', 'RECURRING');

CREATE TYPE "RecurringExpenseFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- Despesa fixa recorrente
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "professional_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "category" TEXT,
    "method" "FinancialTransactionMethod" NOT NULL DEFAULT 'OTHER',
    "frequency" "RecurringExpenseFrequency" NOT NULL DEFAULT 'MONTHLY',
    "anchor_day" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringExpense_professional_user_id_active_idx" ON "RecurringExpense"("professional_user_id", "active");

ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_professional_user_id_fkey" FOREIGN KEY ("professional_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campos novos em FinancialTransaction
ALTER TABLE "FinancialTransaction" ADD COLUMN "expense_nature" "ExpenseNature";

ALTER TABLE "FinancialTransaction" ADD COLUMN "category" TEXT;

ALTER TABLE "FinancialTransaction" ADD COLUMN "source" "FinancialEntrySource" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "FinancialTransaction" ADD COLUMN "recurring_expense_id" TEXT;

ALTER TABLE "FinancialTransaction" ADD COLUMN "period_key" TEXT;

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Idempotência da materialização (recurring_expense_id, period_key); múltiplos NULL são permitidos no Postgres
CREATE UNIQUE INDEX "FinancialTransaction_recurring_expense_id_period_key_key" ON "FinancialTransaction"("recurring_expense_id", "period_key");

CREATE INDEX "FinancialTransaction_professional_user_id_kind_occurred_at_idx" ON "FinancialTransaction"("professional_user_id", "kind", "occurred_at");

-- RLS deny-by-default (igual às demais tabelas financeiras): bloqueia PostgREST anon/authenticated;
-- Prisma/postgres com BYPASSRLS não é afetado.
ALTER TABLE "RecurringExpense" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_postgrest_recurringexpense" ON "RecurringExpense";

CREATE POLICY "deny_postgrest_recurringexpense" ON "RecurringExpense" FOR ALL USING (false) WITH CHECK (false);
