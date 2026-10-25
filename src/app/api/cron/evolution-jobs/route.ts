import { NextRequest, NextResponse } from "next/server";
import {
  failStaleEvolutionProcessingJobs,
  failStaleFinanceAgentJobs,
  failStaleOfficeFinanceExtractionJobs,
} from "@/lib/evolution-job-stale";
import { logger } from "@/lib/logger";
import {
  claimNextEvolutionProcessingJob,
  processEvolutionJobById,
} from "@/lib/evolution-job-worker";
import {
  claimNextOfficeFinanceExtractionJob,
  processOfficeFinanceJobById,
} from "@/lib/office-finance-job-worker";
import {
  claimNextFinanceAgentJob,
  processFinanceAgentJobById,
} from "@/lib/finance-agent-job-worker";

/**
 * Segment config do Next precisa de literal estático.
 * Em Vercel Hobby o teto efetivo costuma ser 300s.
 */
export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Worker em background (Vercel Cron ou chamada manual com Authorization).
 * GET por convenção do cron da Vercel.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let staleFailed = 0;
  let staleOfficeFinanceFailed = 0;
  let staleFinanceAgentFailed = 0;
  try {
    staleFailed = await failStaleEvolutionProcessingJobs();
    staleOfficeFinanceFailed = await failStaleOfficeFinanceExtractionJobs();
    staleFinanceAgentFailed = await failStaleFinanceAgentJobs();
    if (staleFailed > 0) {
      logger.warn("Cron evolution-jobs: jobs PROCESSING obsoletos marcados como FAILED", {
        feature: "api/cron/evolution-jobs",
        count: staleFailed,
      });
    }
    if (staleOfficeFinanceFailed > 0) {
      logger.warn(
        "Cron evolution-jobs: jobs financeiros PROCESSING obsoletos marcados como FAILED",
        {
          feature: "api/cron/evolution-jobs",
          kind: "office-finance",
          count: staleOfficeFinanceFailed,
        },
      );
    }
    if (staleFinanceAgentFailed > 0) {
      logger.warn(
        "Cron evolution-jobs: jobs do agente financeiro PROCESSING obsoletos marcados como FAILED",
        {
          feature: "api/cron/evolution-jobs",
          kind: "finance-agent",
          count: staleFinanceAgentFailed,
        },
      );
    }
  } catch (e) {
    logger.error("Cron evolution-jobs: falha ao limpar jobs obsoletos", {
      feature: "api/cron/evolution-jobs",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const evolutionJobId = await claimNextEvolutionProcessingJob();
  if (evolutionJobId) {
    await processEvolutionJobById(evolutionJobId);
    return NextResponse.json({
      ok: true,
      processed: 1,
      kind: "evolution",
      jobId: evolutionJobId,
      staleFailed,
      staleOfficeFinanceFailed,
      staleFinanceAgentFailed,
    });
  }

  const financeJobId = await claimNextOfficeFinanceExtractionJob();
  if (financeJobId) {
    await processOfficeFinanceJobById(financeJobId);
    return NextResponse.json({
      ok: true,
      processed: 1,
      kind: "office-finance",
      jobId: financeJobId,
      staleFailed,
      staleOfficeFinanceFailed,
      staleFinanceAgentFailed,
    });
  }

  const financeAgentJobId = await claimNextFinanceAgentJob();
  if (financeAgentJobId) {
    await processFinanceAgentJobById(financeAgentJobId);
    return NextResponse.json({
      ok: true,
      processed: 1,
      kind: "finance-agent",
      jobId: financeAgentJobId,
      staleFailed,
      staleOfficeFinanceFailed,
      staleFinanceAgentFailed,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: 0,
    staleFailed,
    staleOfficeFinanceFailed,
    staleFinanceAgentFailed,
  });
}
