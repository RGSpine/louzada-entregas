/** Códigos de ocupação Carnê-Leão / Receita Saúde (RFB). */
export const CARNE_LEAO_OCCUPATION_OPTIONS = [
  { code: "225", label: "Médico" },
  { code: "226", label: "Odontólogo" },
  { code: "230", label: "Fonoaudiólogo" },
  { code: "231", label: "Fisioterapeuta" },
  { code: "232", label: "Terapeuta ocupacional" },
  { code: "255", label: "Psicólogo" },
] as const;

const PROFESSION_TO_OCCUPATION: Record<string, string> = {
  Medico: "225",
  "Cirurgiao-Dentista": "226",
  Fonoaudiologo: "230",
  Fisioterapeuta: "231",
  "Terapeuta-Ocupacional": "232",
  Psicologo: "255",
};

export function resolveCarneLeaoOccupationCode(
  profession: string | null | undefined,
  override: string | null | undefined,
): string | null {
  const trimmed = override?.trim();
  if (trimmed && /^\d{3}$/.test(trimmed)) return trimmed;
  if (!profession) return null;
  return PROFESSION_TO_OCCUPATION[profession] ?? null;
}

export function occupationLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return CARNE_LEAO_OCCUPATION_OPTIONS.find((o) => o.code === code)?.label ?? code;
}
