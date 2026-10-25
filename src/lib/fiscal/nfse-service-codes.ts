/**
 * Códigos LC 116 / municipais sugeridos por profissão (override no perfil).
 * O contador deve validar o código do município do emitente.
 */
const PROFESSION_TO_NFSE_CODE: Record<string, string> = {
  Medico: "04.01",
  "Cirurgiao-Dentista": "04.02",
  Fonoaudiologo: "04.03",
  Fisioterapeuta: "04.04",
  "Terapeuta-Ocupacional": "04.05",
  Psicologo: "04.06",
};

export function resolveDefaultNfseServiceCode(
  profession: string | null | undefined,
  override: string | null | undefined,
): string | null {
  const trimmed = override?.trim();
  if (trimmed && trimmed.length >= 3) return trimmed;
  if (!profession) return "04.01";
  return PROFESSION_TO_NFSE_CODE[profession] ?? "04.01";
}

export const DEFAULT_NFSE_ISS_ALIQUOTA_PERCENT = 2.0;
