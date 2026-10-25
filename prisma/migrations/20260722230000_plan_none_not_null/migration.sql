-- Corrige crash Prisma: plan null incompatível com tipagem String.
-- Padroniza pré-checkout como "NONE" (não-nulo) + account_status.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "account_status" TEXT NOT NULL DEFAULT 'INCOMPLETE';

-- Converte nulos e sentinelas pré-checkout → NONE
UPDATE "User"
SET "plan" = 'NONE'
WHERE "plan" IS NULL
   OR UPPER(TRIM("plan")) IN ('', 'PENDING', 'INCOMPLETE', 'NULL');

-- Contas sem Stripe e sem parceria: NONE + checkout obrigatório
UPDATE "User"
SET
  "plan" = 'NONE',
  "account_status" = 'INCOMPLETE',
  "basico_checkout_required" = true
WHERE
  "stripe_subscription_id" IS NULL
  AND COALESCE("is_influencer", false) = false
  AND UPPER(TRIM(COALESCE("plan", 'NONE'))) IN ('NONE', 'PENDING', 'INCOMPLETE', 'FREE');

-- Assinantes / influenciadores
UPDATE "User"
SET "account_status" = 'ACTIVE'
WHERE
  "stripe_subscription_id" IS NOT NULL
  OR COALESCE("is_influencer", false) = true;

UPDATE "User"
SET "account_status" = 'BLOCKED'
WHERE "isBlocked" = true;

-- Restaura NOT NULL + default seguro (nunca mais null no banco)
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'NONE';
UPDATE "User" SET "plan" = 'NONE' WHERE "plan" IS NULL;
ALTER TABLE "User" ALTER COLUMN "plan" SET NOT NULL;
