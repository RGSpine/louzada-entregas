import { prisma } from "@/lib/prisma";
import {
  formatDailyHealthLine,
  toDailyHealthCheckView,
  type DailyHealthCheckView,
} from "@/lib/b2c/daily-health-display";

export {
  ACTIVITY_PRESETS,
  BRISTOL_TYPES,
  SLEEP_QUALITY,
  STOOL_COLORS,
  URINE_COLORS,
  WATER_CUP_ML,
  MAX_WATER_CUPS,
  WEARABLE_SOURCES,
  formatDailyHealthLine,
  healthDayDate,
  healthDayKey,
  toDailyHealthCheckView,
  type DailyHealthCheckView,
  type WearableSource,
} from "@/lib/b2c/daily-health-display";


const dailySelect = {
  day: true,
  waterMl: true,
  sleepMinutes: true,
  sleepQuality: true,
  urineColor: true,
  bristolType: true,
  stoolColor: true,
  activityMinutes: true,
  wearableSource: true,
  wearableSteps: true,
  wearableSleepMinutes: true,
  wearableActiveMinutes: true,
  wearableSyncedAt: true,
} as const;

export async function listRecentDailyHealthChecks(
  healthProfileId: string,
  take = 7,
): Promise<DailyHealthCheckView[]> {
  const rows = await prisma.dailyHealthCheck.findMany({
    where: { healthProfileId },
    orderBy: { day: "desc" },
    take,
    select: dailySelect,
  });
  return rows.map(toDailyHealthCheckView);
}

/** Bloco complementar para o assistente. Não substitui consultas nem laudos. */
export async function formatDailyHealthContextBlock(
  healthProfileId: string,
): Promise<string> {
  const rows = await listRecentDailyHealthChecks(healthProfileId, 7);
  if (rows.length === 0) {
    return "(Sem check-in diário. Água, sono, urina, fezes e atividade são opcionais.)";
  }
  return rows.map((row) => formatDailyHealthLine(row)).join("\n");
}
