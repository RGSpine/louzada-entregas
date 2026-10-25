/** Cookie do HealthProfile ativo no Mapa de Saúde (titular ou dependente). */
export const B2C_ACTIVE_PROFILE_COOKIE = "aievolui_b2c_hp";

export const HEALTH_RELATIONSHIP_OPTIONS = [
  { value: "self", label: "Eu (titular)" },
  { value: "child", label: "Filho(a)" },
  { value: "spouse", label: "Cônjuge / parceiro(a)" },
  { value: "parent", label: "Pai / mãe" },
  { value: "other", label: "Outro" },
] as const;

export type HealthRelationship =
  (typeof HEALTH_RELATIONSHIP_OPTIONS)[number]["value"];

export function relationshipLabel(value: string | null | undefined): string {
  const found = HEALTH_RELATIONSHIP_OPTIONS.find((item) => item.value === value);
  return found?.label ?? "Perfil";
}
