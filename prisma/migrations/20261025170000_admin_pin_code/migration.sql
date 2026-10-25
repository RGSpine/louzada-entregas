-- Cópia legível do PIN do administrador, exibida só no perfil dele.
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "pin_code" VARCHAR(4);
