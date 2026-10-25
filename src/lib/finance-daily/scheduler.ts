import { runFinanceDailySuite } from "@/lib/finance-daily/run-suite";
import { logger } from "@/lib/logger";

const DEFAULT_INTERVAL_MS = Number(
  process.env.FINANCE_DAILY_INTERVAL_MS || 24 * 60 * 60 * 1000,
);
const BOOT_DELAY_MS = Number(process.env.FINANCE_DAILY_BOOT_DELAY_MS || 180_000);

declare global {
  // eslint-disable-next-line no-var
  var __financeDailySchedulerStarted: boolean | undefined;
}

function isSchedulerEnabled(): boolean {
  if (process.env.FINANCE_DAILY_AUTO === "0") return false;
  if (process.env.VERCEL === "1") return false;
  if (process.env.NODE_ENV !== "production") return false;
  return true;
}

/**
 * Scheduler interno para `next start`.
 * Em Vercel: `/api/cron/finance-daily-tests` (vercel.json).
 */
export function startFinanceDailyScheduler(): void {
  if (!isSchedulerEnabled()) return;
  if (globalThis.__financeDailySchedulerStarted) return;
  globalThis.__financeDailySchedulerStarted = true;

  logger.info("Scheduler suite diária financeira — activo", {
    feature: "finance-daily-scheduler",
    intervalMs: DEFAULT_INTERVAL_MS,
    bootDelayMs: BOOT_DELAY_MS,
  });

  const tick = () => {
    void runFinanceDailySuite({ source: "scheduler" }).catch((e) => {
      logger.error("Scheduler suite financeira — erro", {
        feature: "finance-daily-scheduler",
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };

  setTimeout(tick, BOOT_DELAY_MS);
  setInterval(tick, DEFAULT_INTERVAL_MS);
}
