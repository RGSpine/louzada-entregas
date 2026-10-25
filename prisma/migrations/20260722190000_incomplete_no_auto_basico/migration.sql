-- Erradica herança Free/Básico automático no cadastro.
-- Novos usuários: plan NULL + account_status INCOMPLETE.
-- ACTIVE / plan comercial só via webhook Stripe (ou influencer).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "account_status" TEXT NOT NULL DEFAULT 'INCOMPLETE';

-- Remove DEFAULT que nascia PENDING/BASICO/FREE
ALTER TABLE "User" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "plan" DROP NOT NULL;

-- Contas sem Stripe e sem parceria: sem plano + incompletas (Free acabou)
UPDATE "User"
SET
  "plan" = NULL,
  "account_status" = 'INCOMPLETE',
  "basico_checkout_required" = true
WHERE
  "stripe_subscription_id" IS NULL
  AND COALESCE("is_influencer", false) = false
  AND (
    "plan" IS NULL
    OR UPPER(TRIM("plan")) IN ('PENDING', 'INCOMPLETE', 'NONE', 'FREE', 'BASICO', '')
  );

-- Assinantes Stripe ou influenciadores: ACTIVE
UPDATE "User"
SET "account_status" = 'ACTIVE'
WHERE
  "stripe_subscription_id" IS NOT NULL
  OR COALESCE("is_influencer", false) = true;

-- Bloqueados administrativos
UPDATE "User"
SET "account_status" = 'BLOCKED'
WHERE "isBlocked" = true;
