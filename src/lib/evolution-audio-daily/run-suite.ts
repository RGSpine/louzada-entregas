import { checkEvolutionAudioEnvIntegrity } from "@/lib/evolution-audio-daily/env-integrity";
import { runUnitThresholdChecks } from "@/lib/evolution-audio-daily/checks/unit-thresholds";
import { runSchemaChecks } from "@/lib/evolution-audio-daily/checks/schemas";
import { runStarterLimitChecks } from "@/lib/evolution-audio-daily/checks/starter-limits";
import { runProductionHealthChecks } from "@/lib/evolution-audio-daily/checks/production-health";
import {
  runE2EAsyncPipelineCheck,
  runGeminiSmokeCheck,
  runPlaywrightPreflightCheck,
} from "@/lib/evolution-audio-daily/checks/e2e-async";
import {
  persistDailyRunReport,
  shouldRunDailySuite,
  startDailyRunRecord,
} from "@/lib/evolution-audio-daily/state";
import { logger } from "@/lib/logger";
import type { DailySuiteReport, RunDailySuiteOptions } from "@/lib/evolution-audio-daily/types";

export type RunDailySuiteOutcome = DailySuiteReport & { runId: string };

/**
 * Orquestra as 10 categorias da suite diária — usada pelo cron Vercel e scheduler interno.
 */
export async function runEvolutionAudioDailySuite(
  options: RunDailySuiteOptions = {},
): Promise<RunDailySuiteOutcome> {
  const source = options.source ?? "cron";
  const envReport = checkEvolutionAudioEnvIntegrity();
  const startedAt = new Date().toISOString();

  const throttle = await shouldRunDailySuite(options.force);
  if (!throttle.run) {
    const report: DailySuiteReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: true,
      skipped: true,
      skipReason: throttle.reason,
      source,
      envReport,
      results: [],
    };
    const runId = await startDailyRunRecord(source, envReport);
    await persistDailyRunReport(report, runId);
    logger.info("Suite diária áudio evolução — omitida (throttle 24h)", {
      feature: "evolution-audio-daily",
      reason: throttle.reason,
      source,
    });
    return { ...report, runId };
  }

  if (!envReport.readyForAutoRun) {
    const report: DailySuiteReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: false,
      skipped: true,
      skipReason: `Env incompleta: ${envReport.missingRequired.join(", ")}`,
      source,
      envReport,
      results: [],
    };
    const runId = await startDailyRunRecord(source, envReport);
    await persistDailyRunReport(report, runId);
    logger.warn("Suite diária áudio evolução — env incompleta", {
      feature: "evolution-audio-daily",
      missing: envReport.missingRequired,
      source,
    });
    return { ...report, runId };
  }

  const runId = await startDailyRunRecord(source, envReport);
  logger.info("Suite diária áudio evolução — início", {
    feature: "evolution-audio-daily",
    source,
    runId,
  });

  const results = [
    ...runUnitThresholdChecks(),
    await runE2EAsyncPipelineCheck(),
    runPlaywrightPreflightCheck(),
    runStarterLimitChecks(),
    ...runSchemaChecks(),
    ...(await runProductionHealthChecks()),
    await runGeminiSmokeCheck(),
  ].sort((a, b) => a.id - b.id);

  const hardFails = results.filter((r) => !r.ok && !r.skipped);
  const report: DailySuiteReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: hardFails.length === 0,
    skipped: false,
    source,
    envReport,
    results,
  };

  await persistDailyRunReport(report, runId);

  if (hardFails.length > 0) {
    logger.error("Suite diária áudio evolução — falhas críticas", {
      feature: "evolution-audio-daily",
      runId,
      fails: hardFails.map((f) => ({ id: f.id, detail: f.detail })),
    });
  } else {
    logger.info("Suite diária áudio evolução — concluída OK", {
      feature: "evolution-audio-daily",
      runId,
      ok: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    });
  }

  return { ...report, runId };
}
