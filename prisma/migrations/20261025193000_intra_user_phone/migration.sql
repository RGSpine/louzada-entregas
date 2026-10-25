-- Telefone do entregador, no mesmo limite do telefone do cliente.
ALTER TABLE "IntraUser" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(40);
