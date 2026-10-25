-- AlterEnum
ALTER TYPE "CrmPlanChangeReason" ADD VALUE IF NOT EXISTS 'CANCEL_SCHEDULED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripe_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "User_stripe_cancel_at_period_end_idx"
  ON "User"("stripe_cancel_at_period_end")
  WHERE "stripe_cancel_at_period_end" = true;
