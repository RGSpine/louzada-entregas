export type EvolutionServiceSuggestion = {
  serviceId: string;
  serviceName: string;
  defaultPriceCents: number;
  confidence: "CATALOG_TERM_EXACT";
};

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta menções literais ao catálogo no texto já produzido pela evolução.
 * Não chama outra IA, não persiste e não decide cobrança: apenas sugere.
 */
export function detectEvolutionServiceSuggestion(
  text: string,
  services: Array<{ id: string; name: string; defaultPriceCents: number }>,
): EvolutionServiceSuggestion | null {
  const haystack = ` ${normalizeForMatch(text)} `;
  if (haystack.trim().length < 4) return null;

  const matches = services
    .map((service) => ({
      service,
      normalizedName: normalizeForMatch(service.name),
    }))
    .filter(
      ({ normalizedName }) =>
        normalizedName.length >= 4 && haystack.includes(` ${normalizedName} `),
    )
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length);

  const top = matches[0];
  if (!top) return null;

  const conflicting = matches.find(
    (candidate, index) =>
      index > 0 &&
      candidate.normalizedName !== top.normalizedName &&
      !top.normalizedName.includes(candidate.normalizedName),
  );
  if (conflicting) return null;

  return {
    serviceId: top.service.id,
    serviceName: top.service.name,
    defaultPriceCents: top.service.defaultPriceCents,
    confidence: "CATALOG_TERM_EXACT",
  };
}
