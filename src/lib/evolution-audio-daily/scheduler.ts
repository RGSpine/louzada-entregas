import { runEvolutionAudioDailySuite } from "@/lib/evolution-audio-daily/run-suite";
import { logger } from "@/lib/logger";

const DEFAULT_INTERVAL_MS = Number(
  process.env.EVOLUTION_AUDIO_DAILY_INTERVAL_MS || 24 * 60 * 60 * 1000,
);
const BOOT_DELAY_MS = Number(process.env.EVOLUTION_AUDIO_DAILY_BOOT_DELAY_MS || 120_000);

declare global {
  // eslint-disable-next-line no-var
  var __evolutionAudioDailySchedulerStarted: boolean | undefined;
}

function isSchedulerEnabled(): boolean {
  if (process.env.EVOLUTION_AUDIO_DAILY_AUTO === "0") return false;
  if (process.env.VERCEL === "1") return false;
  if (process.env.NODE_ENV !== "production") return false;
  return true;
}

/**
 * Scheduler interno para `next start` / servidores persistentes.
 * Em Vercel usa-se `/api/cron/evolution-audio-daily-tests` (vercel.json).
 */
export function startEvolutionAudioDailyScheduler(): void {
  if (!isSchedulerEnabled()) return;
  if (globalThis.__evolutionAudioDailySchedulerStarted) return;
  globalThis.__evolutionAudioDailySchedulerStarted = true;

  logger.info("Scheduler suite diária áudio evolução — activo", {
    feature: "evolution-audio-daily-scheduler",
    intervalMs: DEFAULT_INTERVAL_MS,
    bootDelayMs: BOOT_DELAY_MS,
  });

  const tick = () => {
    void runEvolutionAudioDailySuite({ source: "scheduler" }).catch((e) => {
      logger.error("Scheduler suite diária — erro", {
        feature: "evolution-audio-daily-scheduler",
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };

  setTimeout(tick, BOOT_DELAY_MS);
  setInterval(tick, DEFAULT_INTERVAL_MS);
}
