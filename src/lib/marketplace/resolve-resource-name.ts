export type ResourceRef = { id: string; name: string };

function normalize(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveResourceFromGuess(
  guess: string | null | undefined,
  resources: ResourceRef[],
): ResourceRef | null {
  const key = normalize(guess ?? "");
  if (!key || resources.length === 0) return null;
  const exact = resources.find((item) => normalize(item.name) === key);
  if (exact) return exact;
  return (
    resources.find(
      (item) =>
        normalize(item.name).includes(key) || key.includes(normalize(item.name)),
    ) ?? null
  );
}
