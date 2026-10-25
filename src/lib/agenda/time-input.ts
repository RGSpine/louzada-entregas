/** Normaliza valor de `<input type="time">` para HH:mm (remove segundos). */
export function normalizeTimeInputValue(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return trimmed;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return trimmed;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
