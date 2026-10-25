/** Data curta do admin. Arquivo sem Prisma para as páginas cliente não puxarem o servidor. */
export function formatAdminDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
