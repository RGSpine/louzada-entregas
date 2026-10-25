-- CreateEnum
CREATE TYPE "CrmCommercialStage" AS ENUM ('TRIAL_ACTIVE', 'ENGAGED', 'OPPORTUNITY', 'CUSTOMER_PAID', 'AT_RISK', 'CHURNED', 'INFLUENCER');

-- CreateEnum
CREATE TYPE "CrmChurnRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CrmAhaMomentType" AS ENUM ('FIRST_EVOLUTION', 'FIRST_PATIENT', 'FIRST_AGENDA', 'FIRST_FINANCE', 'FIRST_CHAT', 'FIRST_DOCUMENT');

-- CreateEnum
CREATE TYPE "CrmAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CrmAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CrmAlertChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CrmPlanChangeReason" AS ENUM ('UPGRADE_USAGE', 'DOWNGRADE_COST', 'CHURN_VOLUNTARY', 'CHURN_PAYMENT_FAILED', 'INFLUENCER_GRANT', 'ADMIN_ADJUSTMENT', 'COUPON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CrmSatisfactionType" AS ENUM ('NPS_D7', 'NPS_D30', 'NPS_D90', 'CSAT_SUPPORT', 'CSAT_ONBOARDING');

-- CreateEnum
CREATE TYPE "CrmConversationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'PHONE', 'IN_APP');

-- CreateTable
CREATE TABLE "crm_account_profile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "commercial_stage" "CrmCommercialStage" NOT NULL DEFAULT 'TRIAL_ACTIVE',
    "referred_by_user_id" TEXT,
    "referral_code" VARCHAR(32),
    "first_evolution_at" TIMESTAMPTZ(6),
    "first_patient_at" TIMESTAMPTZ(6),
    "first_agenda_at" TIMESTAMPTZ(6),
    "first_finance_at" TIMESTAMPTZ(6),
    "first_chat_at" TIMESTAMPTZ(6),
    "first_document_at" TIMESTAMPTZ(6),
    "aha_moment_at" TIMESTAMPTZ(6),
    "aha_moment_type" "CrmAhaMomentType",
    "features_activated" JSONB,
    "health_score" INTEGER NOT NULL DEFAULT 0,
    "churn_risk" "CrmChurnRisk" NOT NULL DEFAULT 'LOW',
    "ltv_cents" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMPTZ(6),
    "metrics_computed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_account_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_plan_change_event" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "from_plan" TEXT NOT NULL,
    "to_plan" TEXT NOT NULL,
    "reason" "CrmPlanChangeReason" NOT NULL DEFAULT 'UNKNOWN',
    "reason_note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "stripe_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_plan_change_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_satisfaction_survey" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "type" "CrmSatisfactionType" NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT,
    "milestone_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_satisfaction_survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_alert" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" "CrmAlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "suggested_channel" "CrmAlertChannel" NOT NULL,
    "suggested_message" TEXT,
    "status" "CrmAlertStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "crm_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_admin_note" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_admin_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_conversation_log" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "channel" "CrmConversationChannel" NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "logged_by_admin_id" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_conversation_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_account_profile_user_id_key" ON "crm_account_profile"("user_id");

-- CreateIndex
CREATE INDEX "crm_account_profile_commercial_stage_idx" ON "crm_account_profile"("commercial_stage");

-- CreateIndex
CREATE INDEX "crm_account_profile_churn_risk_idx" ON "crm_account_profile"("churn_risk");

-- CreateIndex
CREATE INDEX "crm_account_profile_health_score_idx" ON "crm_account_profile"("health_score");

-- CreateIndex
CREATE INDEX "crm_plan_change_event_profile_id_created_at_idx" ON "crm_plan_change_event"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_satisfaction_survey_profile_id_type_idx" ON "crm_satisfaction_survey"("profile_id", "type");

-- CreateIndex
CREATE INDEX "crm_alert_status_severity_idx" ON "crm_alert"("status", "severity");

-- CreateIndex
CREATE INDEX "crm_alert_user_id_idx" ON "crm_alert"("user_id");

-- CreateIndex
CREATE INDEX "crm_alert_profile_id_alert_type_status_idx" ON "crm_alert"("profile_id", "alert_type", "status");

-- CreateIndex
CREATE INDEX "crm_admin_note_profile_id_created_at_idx" ON "crm_admin_note"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_conversation_log_profile_id_occurred_at_idx" ON "crm_conversation_log"("profile_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "crm_account_profile" ADD CONSTRAINT "crm_account_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_account_profile" ADD CONSTRAINT "crm_account_profile_referred_by_user_id_fkey" FOREIGN KEY ("referred_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_plan_change_event" ADD CONSTRAINT "crm_plan_change_event_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_account_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_satisfaction_survey" ADD CONSTRAINT "crm_satisfaction_survey_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_account_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_alert" ADD CONSTRAINT "crm_alert_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_account_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_admin_note" ADD CONSTRAINT "crm_admin_note_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_account_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_admin_note" ADD CONSTRAINT "crm_admin_note_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_conversation_log" ADD CONSTRAINT "crm_conversation_log_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_account_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS deny-by-default (dados comerciais sensíveis — só Server Actions admin)
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_account_profile',
    'crm_plan_change_event',
    'crm_satisfaction_survey',
    'crm_alert',
    'crm_admin_note',
    'crm_conversation_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny_postgrest_%s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "deny_postgrest_%s" ON %I FOR ALL USING (false) WITH CHECK (false)',
      t,
      t
    );
  END LOOP;
END $do$;
