/** Profissões que existem no cadastro, mas não entram na vitrine nem nos gráficos públicos. */
export const SHOWCASE_EXCLUDED_PROFESSIONS = ["Estudante"] as const;

export function isShowcaseEligibleProfession(
  profession: string | null | undefined,
): boolean {
  const value = profession?.trim();
  if (!value) return false;
  return !SHOWCASE_EXCLUDED_PROFESSIONS.some(
    (excluded) => excluded.localeCompare(value, "pt-BR", { sensitivity: "accent" }) === 0,
  );
}
