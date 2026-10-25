/** Distribui centavos inteiros em N partes (resto vai às primeiras fatias). */
export function splitCentsAcrossParts(totalCents: number, partCount: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("totalCents inválido");
  }
  if (!Number.isInteger(partCount) || partCount <= 0) {
    throw new Error("partCount inválido");
  }
  const base = Math.floor(totalCents / partCount);
  const remainder = totalCents - base * partCount;
  return Array.from({ length: partCount }, (_, i) => base + (i < remainder ? 1 : 0));
}
