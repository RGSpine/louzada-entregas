import {
  findStuckEvolutionJobs,
  record,
  type StepResult,
} from "@/lib/evolution-audio-daily/e2e-helpers";
import { prisma } from "@/lib/prisma";
import type { DailySuiteResult } from "@/lib/evolution-audio-daily/types";

function stepsToResult(id: number, name: string, steps: StepResult[]): DailySuiteResult {
  const failed = steps.filter((s) => !s.ok);
  return {
    id,
    name,
    ok: failed.length === 0,
    skipped: false,
    detail:
      failed.length === 0
        ? steps.map((s) => s.detail).join(" · ")
        : failed.map((f) => `${f.id}: ${f.detail}`).join(" · "),
  };
}

/** Categorias #5 e #10 — CRON, kick, jobs presos, métricas 24h. */
export async function runProductionHealthChecks(): Promise<DailySuiteResult[]> {
  const steps: StepResult[] = [];
  const base = process.env.E2E_EVOLUTION_BASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.CRON_SECRET?.trim();
  const staleMin = Number(process.env.E2E_STUCK_JOB_MINUTES || 30);

  record(
    steps,
    "env-cron-secret",
    !!secret,
    secret ? "CRON_SECRET definida" : "CRON_SECRET ausente",
  );

  if (base && secret) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/api/cron/evolution-jobs`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      record(
        steps,
        "kick-worker-http",
        res.ok,
        `GET /api/cron/evolution-jobs → ${res.status} processed=${(body as { processed?: number }).processed ?? "?"}`,
        Date.now() - t0,
      );
    } catch (e) {
      record(steps, "kick-worker-http", false, e instanceof Error ? e.message : String(e));
    }
  } else if (!base) {
    record(
      steps,
      "kick-worker-http",
      true,
      "Omitido kick HTTP — E2E_EVOLUTION_BASE_URL não definida (self-hosted OK)",
    );
  } else {
    record(steps, "kick-worker-http", false, "CRON_SECRET ausente para kick HTTP");
  }

  try {
    const stuck = await findStuckEvolutionJobs(staleMin);
    record(
      steps,
      "stuck-jobs",
      stuck.length === 0,
      stuck.length === 0
        ? `Nenhum job > ${staleMin} min`
        : `${stuck.length} job(s) preso(s)`,
    );
  } catch (e) {
    record(steps, "stuck-jobs", false, e instanceof Error ? e.message : "Prisma indisponível");
  }

  const observabilitySteps: StepResult[] = [];
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [queued, processing, succeeded, failed] = await Promise.all([
      prisma.evolutionProcessingJob.count({
        where: { status: "QUEUED", createdAt: { gte: last24h } },
      }),
      prisma.evolutionProcessingJob.count({
        where: { status: "PROCESSING", createdAt: { gte: last24h } },
      }),
      prisma.evolutionProcessingJob.count({
        where: { status: "SUCCEEDED", createdAt: { gte: last24h } },
      }),
      prisma.evolutionProcessingJob.count({
        where: { status: "FAILED", createdAt: { gte: last24h } },
      }),
    ]);
    const failRate =
      succeeded + failed > 0 ? ((failed / (succeeded + failed)) * 100).toFixed(1) : "0";
    record(
      observabilitySteps,
      "observability-24h",
      true,
      `24h: Q=${queued} P=${processing} OK=${succeeded} FAIL=${failed} (${failRate}%)`,
    );
  } catch {
    record(observabilitySteps, "observability-24h", false, "Métricas 24h indisponíveis");
  }

  return [
    stepsToResult(5, "Produção: CRON_SECRET + kick + jobs presos", steps),
    stepsToResult(
      10,
      "Observabilidade — métricas 24h",
      observabilitySteps,
    ),
  ];
}
