import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import type { DailySuiteReport } from "@/lib/evolution-audio-daily/types";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOCAL_STATE_PATH = join(process.cwd(), "test-fixtures/evolution-audio-daily-last-run.json");

function readLocalLastRun(): Date | null {
  if (!existsSync(LOCAL_STATE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(LOCAL_STATE_PATH, "utf8")) as { finishedAt?: string };
    if (!raw.finishedAt) return null;
    return new Date(raw.finishedAt);
  } catch {
    return null;
  }
}

function writeLocalState(report: DailySuiteReport) {
  try {
    const dir = join(process.cwd(), "test-fixtures");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LOCAL_STATE_PATH, JSON.stringify(report, null, 2));
  } catch {
    /* best-effort local dev */
  }
}

export async function getLastDailyRunFinishedAt(): Promise<Date | null> {
  try {
    const row = await prisma.evolutionAudioDailyRun.findFirst({
      where: { skipped: false, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    if (row?.finishedAt) return row.finishedAt;
  } catch {
    /* Prisma indisponível — fallback ficheiro */
  }
  return readLocalLastRun();
}

export async function shouldRunDailySuite(force = false): Promise<{ run: boolean; reason?: string }> {
  if (force || process.env.EVOLUTION_AUDIO_DAILY_FORCE === "1") {
    return { run: true };
  }
  const last = await getLastDailyRunFinishedAt();
  if (!last) return { run: true };
  const elapsed = Date.now() - last.getTime();
  if (elapsed >= INTERVAL_MS) return { run: true };
  const hoursLeft = ((INTERVAL_MS - elapsed) / (60 * 60 * 1000)).toFixed(1);
  return { run: false, reason: `Última corrida há ${(elapsed / (60 * 60 * 1000)).toFixed(1)}h — faltam ~${hoursLeft}h` };
}

export async function persistDailyRunReport(
  report: DailySuiteReport,
  runId?: string,
): Promise<string> {
  writeLocalState(report);

  try {
    if (runId) {
      await prisma.evolutionAudioDailyRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(report.finishedAt),
          passed: report.passed,
          skipped: report.skipped,
          skipReason: report.skipReason ?? null,
          results: report.results,
          envReport: report.envReport,
        },
      });
      return runId;
    }

    const created = await prisma.evolutionAudioDailyRun.create({
      data: {
        startedAt: new Date(report.startedAt),
        finishedAt: new Date(report.finishedAt),
        passed: report.passed,
        skipped: report.skipped,
        skipReason: report.skipReason ?? null,
        source: report.source,
        results: report.results,
        envReport: report.envReport,
      },
    });
    return created.id;
  } catch {
    return runId ?? "local-only";
  }
}

export async function startDailyRunRecord(
  source: DailySuiteReport["source"],
  envReport: DailySuiteReport["envReport"],
): Promise<string> {
  try {
    const row = await prisma.evolutionAudioDailyRun.create({
      data: {
        source,
        envReport,
        results: [],
      },
    });
    return row.id;
  } catch {
    return "local-only";
  }
}

export async function getLatestDailyRunSummary() {
  try {
    return await prisma.evolutionAudioDailyRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        passed: true,
        skipped: true,
        skipReason: true,
        source: true,
        results: true,
      },
    });
  } catch {
    return null;
  }
}
