-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dashboard_inbox_read_ids" JSONB;
