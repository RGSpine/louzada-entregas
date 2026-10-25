/**
 * Cores estáveis por paciente na agenda (barra lateral).
 * Fundo amarelo/verde continua = confirmação (Starter+).
 */
export const PATIENT_AGENDA_COLOR_PALETTE = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // amber
  "#22c55e", // green
  "#14b8a6", // teal
  "#0ea5e9", // sky
  "#3b82f6", // blue
] as const;

export type PatientAgendaColor = (typeof PATIENT_AGENDA_COLOR_PALETTE)[number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isPatientAgendaColor(value: string): value is PatientAgendaColor {
  return (PATIENT_AGENDA_COLOR_PALETTE as readonly string[]).includes(value);
}

export function normalizePatientAgendaColorInput(
  value: string | null | undefined,
): PatientAgendaColor | null {
  if (value == null || value.trim() === "") return null;
  const trimmed = value.trim().toLowerCase();
  if (!HEX_COLOR.test(trimmed)) return null;
  const normalized = `#${trimmed.slice(1)}`;
  return isPatientAgendaColor(normalized) ? normalized : null;
}

/** Índice estável 0..palette-1 a partir do id do paciente. */
export function patientAgendaColorIndexFromId(patientId: string): number {
  let hash = 0;
  for (let i = 0; i < patientId.length; i++) {
    hash = (hash * 31 + patientId.charCodeAt(i)) >>> 0;
  }
  return hash % PATIENT_AGENDA_COLOR_PALETTE.length;
}

export function resolvePatientAgendaColor(
  patientId: string,
  storedColor: string | null | undefined,
): PatientAgendaColor {
  const normalized = storedColor ? normalizePatientAgendaColorInput(storedColor) : null;
  if (normalized) return normalized;
  return PATIENT_AGENDA_COLOR_PALETTE[patientAgendaColorIndexFromId(patientId)]!;
}
