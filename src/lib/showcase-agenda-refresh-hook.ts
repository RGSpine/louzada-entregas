type RefreshAgenda = (userId: string) => void;

const registry = globalThis as unknown as {
  __showcaseAgendaRefresh?: RefreshAgenda;
};

/** O servidor registra a função real. O cliente do Prisma não importa a agenda. */
export function setShowcaseAgendaRefresh(refresh: RefreshAgenda): void {
  registry.__showcaseAgendaRefresh = refresh;
}

export function runShowcaseAgendaRefresh(userId: string): void {
  registry.__showcaseAgendaRefresh?.(userId);
}
