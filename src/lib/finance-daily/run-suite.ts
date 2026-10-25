import { checkFinanceDailyEnvIntegrity } from "@/lib/finance-daily/env-integrity";
import {
  persistFinanceDailyRunReport,
  shouldRunFinanceDailySuite,
  startFinanceDailyRunRecord,
} from "@/lib/finance-daily/state";
import {
  runFinanceQaDbChecks,
  runFinanceSmokeStagingCheck,
  runFinanceUnitChecks,
} from "@/lib/finance-daily/checks";
import { logger } from "@/lib/logger";
import type {
  FinanceDailyReport,
  RunFinanceDailyOptions,
} from "@/lib/finance-daily/types";

export type RunFinanceDailyOutcome = FinanceDailyReport & { runId: string };

/**
 * Suite diária — Consultório Financeiro (qualidade contínua).
 * Cron Vercel + scheduler self-hosted + npm run test:finance-daily.
 */
export async function runFinanceDailySuite(
  options: RunFinanceDailyOptions = {},
): Promise<RunFinanceDailyOutcome> {
  const source = options.source ?? "cron";
  const envReport = checkFinanceDailyEnvIntegrity();
  const startedAt = new Date().toISOString();

  const throttle = await shouldRunFinanceDailySuite(options.force);
  if (!throttle.run) {
    const report: FinanceDailyReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: true,
      skipped: true,
      skipReason: throttle.reason,
      source,
      envReport,
      results: [],
    };
    const runId = await startFinanceDailyRunRecord(source, envReport);
    await persistFinanceDailyRunReport(report, runId);
    logger.info("Suite diária financeira — omitida (throttle 24h)", {
      feature: "finance-daily",
      reason: throttle.reason,
      source,
    });
    return { ...report, runId };
  }

  if (!envReport.readyForAutoRun) {
    const report: FinanceDailyReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: false,
      skipped: true,
      skipReason: `Env incompleta: ${envReport.missingRequired.join(", ")}`,
      source,
      envReport,
      results: [],
    };
    const runId = await startFinanceDailyRunRecord(source, envReport);
    await persistFinanceDailyRunReport(report, runId);
    logger.warn("Suite diária financeira — env incompleta", {
      feature: "finance-daily",
      missing: envReport.missingRequired,
      source,
    });
    return { ...report, runId };
  }

  const runId = await startFinanceDailyRunRecord(source, envReport);
  logger.info("Suite diária financeira — início", {
    feature: "finance-daily",
    source,
    runId,
  });

  const results = [
    ...(await runFinanceUnitChecks()),
    ...(await runFinanceQaDbChecks()),
    await runFinanceSmokeStagingCheck(),
  ].sort((a, b) => a.id - b.id);

  const hardFails = results.filter((r) => !r.ok && !r.skipped);
  const report: FinanceDailyReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: hardFails.length === 0,
    skipped: false,
    source,
    envReport,
    results,
  };

  await persistFinanceDailyRunReport(report, runId);

  if (hardFails.length > 0) {
    logger.error("Suite diária financeira — falhou", {
      feature: "finance-daily",
      runId,
      fails: hardFails.map((f) => ({ id: f.id, name: f.name, detail: f.detail })),
    });
  } else {
    logger.info("Suite diária financeira — OK", {
      feature: "finance-daily",
      runId,
      passed: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    });
  }

  return { ...report, runId };
}
