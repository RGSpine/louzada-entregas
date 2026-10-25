-- Novos cadastros: plan=PENDING e checkout obrigatório por padrão.
-- Linhas existentes NÃO são alteradas (assinantes e free legado permanecem).
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'PENDING';
ALTER TABLE "User" ALTER COLUMN "basico_checkout_required" SET DEFAULT true;
