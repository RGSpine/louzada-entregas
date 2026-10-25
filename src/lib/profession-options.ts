/** Opções de profissão no cadastro e exibição pública (landing). Fonte única de verdade. */
export const professionOptions = [
  { label: "Cirurgião-Dentista", value: "Cirurgiao-Dentista", council: "CRO" },
  { label: "Enfermeiro", value: "Enfermeiro", council: "COREN" },
  { label: "Estudante", value: "Estudante", council: "Acadêmico" },
  { label: "Fisioterapeuta", value: "Fisioterapeuta", council: "CREFITO" },
  { label: "Fonoaudiólogo", value: "Fonoaudiologo", council: "CREFON" },
  { label: "Médico", value: "Medico", council: "CRM" },
  { label: "Nutricionista", value: "Nutricionista", council: "CRN" },
  { label: "Profissional de Educação Física", value: "Educacao-Fisica", council: "CREF" },
  { label: "Psicólogo", value: "Psicologo", council: "CRP" },
  { label: "Terapeuta Ocupacional", value: "Terapeuta-Ocupacional", council: "CREFITO" },
  { label: "Veterinário", value: "Veterinario", council: "CRMV" },
] as const;

/** Rótulo público. Se o valor não estiver na lista, devolve o texto cadastrado. */
export function professionPublicLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const found = professionOptions.find(
    (item) => item.value === trimmed || item.label === trimmed,
  );
  return found?.label ?? trimmed;
}
