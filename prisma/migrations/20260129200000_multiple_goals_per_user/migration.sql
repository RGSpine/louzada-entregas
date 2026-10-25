-- DropIndex: Remove unique constraint from userId only
DROP INDEX IF EXISTS "UserGoal_userId_key";

-- CreateIndex: Add composite unique constraint for userId + type
CREATE UNIQUE INDEX "UserGoal_userId_type_key" ON "UserGoal"("userId", "type");

-- CreateIndex: Add index on userId for faster queries
CREATE INDEX "UserGoal_userId_idx" ON "UserGoal"("userId");
