export type ProsthesisPrice = {
  name: string;
  defaultPriceCents: number;
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Preço do catálogo quando o áudio cita a prótese e não cita outro valor.
 * Prefere o nome mais específico que cabe no texto.
 */
export function matchProsthesisPrice(
  text: string | null | undefined,
  catalog: ProsthesisPrice[],
): number | null {
  const work = fold(text ?? "");
  if (work.length < 3) return null;
  let best: { cents: number; length: number } | null = null;
  for (const item of catalog) {
    if (item.defaultPriceCents <= 0) continue;
    const name = fold(item.name);
    if (name.length < 3) continue;
    if (work !== name && !work.includes(name)) continue;
    if (!best || name.length > best.length) {
      best = { cents: item.defaultPriceCents, length: name.length };
    }
  }
  return best?.cents ?? null;
}
