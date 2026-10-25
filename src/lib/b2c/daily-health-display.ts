export const WATER_CUP_ML = 250;
export const MAX_WATER_CUPS = 16;

export const URINE_COLORS = [
  { id: "pale", label: "Clara" },
  { id: "yellow", label: "Amarela" },
  { id: "dark", label: "Amarela escura" },
  { id: "amber", label: "Âmbar" },
] as const;

export const STOOL_COLORS = [
  { id: "brown", label: "Marrom" },
  { id: "yellow", label: "Amarelada" },
  { id: "green", label: "Esverdeada" },
  { id: "pale", label: "Muito clara" },
  { id: "black", label: "Preta" },
  { id: "red", label: "Avermelhada" },
] as const;

export const BRISTOL_TYPES = [
  { type: 1, label: "1 · Dura e separada" },
  { type: 2, label: "2 · Grumosa" },
  { type: 3, label: "3 · Com rachaduras" },
  { type: 4, label: "4 · Lisa e macia" },
  { type: 5, label: "5 · Pedaços moles" },
  { type: 6, label: "6 · Pastosa" },
  { type: 7, label: "7 · Líquida" },
] as const;

export const SLEEP_QUALITY = [
  { value: 1, label: "Péssima" },
  { value: 2, label: "Ruim" },
  { value: 3, label: "Regular" },
  { value: 4, label: "Boa" },
  { value: 5, label: "Ótima" },
] as const;

export const ACTIVITY_PRESETS = [0, 15, 30, 45, 60, 90, 120] as const;

export const WEARABLE_SOURCES = [
  "apple_health",
  "health_connect",
  "garmin",
  "other",
] as const;

export type WearableSource = (typeof WEARABLE_SOURCES)[number];

export type DailyHealthCheckView = {
  day: string;
  waterMl: number | null;
  sleepMinutes: number | null;
  sleepQuality: number | null;
  urineColor: string | null;
  bristolType: number | null;
  stoolColor: string | null;
  activityMinutes: number | null;
  wearableSource: string | null;
  wearableSteps: number | null;
  wearableSleepMinutes: number | null;
  wearableActiveMinutes: number | null;
  wearableSyncedAt: string | null;
};

type DailyHealthRow = {
  day: Date;
  waterMl: number | null;
  sleepMinutes: number | null;
  sleepQuality: number | null;
  urineColor: string | null;
  bristolType: number | null;
  stoolColor: string | null;
  activityMinutes: number | null;
  wearableSource: string | null;
  wearableSteps: number | null;
  wearableSleepMinutes: number | null;
  wearableActiveMinutes: number | null;
  wearableSyncedAt: Date | null;
};

/** Dia civil em America/Sao_Paulo, formato YYYY-MM-DD. */
export function healthDayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function healthDayDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function toDailyHealthCheckView(row: DailyHealthRow): DailyHealthCheckView {
  return {
    day: row.day.toISOString().slice(0, 10),
    waterMl: row.waterMl,
    sleepMinutes: row.sleepMinutes,
    sleepQuality: row.sleepQuality,
    urineColor: row.urineColor,
    bristolType: row.bristolType,
    stoolColor: row.stoolColor,
    activityMinutes: row.activityMinutes,
    wearableSource: row.wearableSource,
    wearableSteps: row.wearableSteps,
    wearableSleepMinutes: row.wearableSleepMinutes,
    wearableActiveMinutes: row.wearableActiveMinutes,
    wearableSyncedAt: row.wearableSyncedAt?.toISOString() ?? null,
  };
}

function labelOf(
  options: ReadonlyArray<{ id: string; label: string }>,
  id: string | null,
): string | null {
  if (!id) return null;
  return options.find((item) => item.id === id)?.label ?? null;
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, "0")}`;
}

export function formatDailyHealthLine(row: DailyHealthCheckView): string {
  const bits: string[] = [row.day];
  if (row.waterMl != null) {
    bits.push(`${Math.round(row.waterMl / WATER_CUP_ML)} copos de água`);
  }
  if (row.sleepMinutes != null) {
    const quality = SLEEP_QUALITY.find((item) => item.value === row.sleepQuality);
    bits.push(
      quality
        ? `sono ${formatHours(row.sleepMinutes)} (${quality.label.toLowerCase()})`
        : `sono ${formatHours(row.sleepMinutes)}`,
    );
  } else if (row.sleepQuality != null) {
    const quality = SLEEP_QUALITY.find((item) => item.value === row.sleepQuality);
    if (quality) bits.push(`qualidade do sono ${quality.label.toLowerCase()}`);
  }
  const urine = labelOf(URINE_COLORS, row.urineColor);
  if (urine) bits.push(`urina ${urine.toLowerCase()}`);
  if (row.bristolType != null) {
    const stool = labelOf(STOOL_COLORS, row.stoolColor);
    bits.push(
      stool
        ? `Bristol ${row.bristolType} (${stool.toLowerCase()})`
        : `Bristol ${row.bristolType}`,
    );
  } else {
    const stool = labelOf(STOOL_COLORS, row.stoolColor);
    if (stool) bits.push(`fezes ${stool.toLowerCase()}`);
  }
  if (row.activityMinutes != null) {
    bits.push(`${row.activityMinutes} min de atividade`);
  }
  const wearable: string[] = [];
  if (row.wearableSteps != null) wearable.push(`${row.wearableSteps} passos`);
  if (row.wearableSleepMinutes != null) {
    wearable.push(`sono do relógio ${formatHours(row.wearableSleepMinutes)}`);
  }
  if (row.wearableActiveMinutes != null) {
    wearable.push(`${row.wearableActiveMinutes} min ativos no relógio`);
  }
  if (wearable.length > 0) {
    bits.push(`relógio (${row.wearableSource ?? "app"}): ${wearable.join(", ")}`);
  }
  return bits.join(" · ");
}
