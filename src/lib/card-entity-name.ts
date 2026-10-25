import { cn } from "@/lib/utils";

/** Nome em card: quebra em até 2 linhas sem ultrapassar a largura do card. */
export const CARD_ENTITY_NAME_CLASS = cn(
  "min-w-0 break-words text-pretty leading-snug [overflow-wrap:anywhere] line-clamp-2",
);

/** Linha avatar + texto em cards de entidade (paciente, usuário). */
export const CARD_ENTITY_HEADER_ROW_CLASS = "flex items-start gap-3";

/** Coluna do título ao lado do avatar. */
export const CARD_ENTITY_TEXT_COLUMN_CLASS = "min-w-0 flex-1";
