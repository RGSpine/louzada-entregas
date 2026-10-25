/**
 * Conversão entre fim exclusivo (materialização / `occurredAt < end`) e
 * fim inclusivo (extrato / `occurredAt <= end`).
 *
 * O par ±1 ms é intencional: o relatório resolve períodos com `endUtc`
 * exclusivo; o extrato precisa do último instante incluído.
 */

/** Fim exclusivo → último instante incluído no filtro `lte`. */
export function inclusiveEndFromExclusiveUtc(endExclusive: Date | string): Date {
  const t =
    typeof endExclusive === "string" ? new Date(endExclusive) : endExclusive;
  return new Date(t.getTime() - 1);
}

/** Fim inclusivo (`lte`) → exclusivo para materialização `[start, end)`. */
export function exclusiveEndFromInclusiveUtc(endInclusive: Date): Date {
  return new Date(endInclusive.getTime() + 1);
}
