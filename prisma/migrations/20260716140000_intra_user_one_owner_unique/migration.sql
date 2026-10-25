-- Um único Intra User dono (is_owner) por Tenant.
-- Limpa duplicados (mantém o mais antigo) antes do índice único parcial,
-- para contas que possam ter sido bootstrapadas em race.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "created_at" ASC, id ASC
    ) AS rn
  FROM "IntraUser"
  WHERE "is_owner" = true
)
UPDATE "IntraUser" AS iu
SET
  "is_owner" = false,
  "updated_at" = NOW()
FROM ranked
WHERE iu.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "IntraUser_one_owner_per_tenant_idx"
  ON "IntraUser" ("user_id")
  WHERE "is_owner" = true;
