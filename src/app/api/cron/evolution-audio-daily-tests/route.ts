import { NextRequest, NextResponse } from "next/server";
import { runEvolutionAudioDailySuite } from "@/lib/evolution-audio-daily/run-suite";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Suite diária de integridade — áudio evolução (10 categorias).
 * Vercel Cron: GET diário com Authorization Bearer CRON_SECRET.
 * Throttle 24h via tabela EvolutionAudioDailyRun.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const force =
    request.nextUrl.searchParams.get("force") === "1" ||
    process.env.EVOLUTION_AUDIO_DAILY_FORCE === "1";

  try {
    const outcome = await runEvolutionAudioDailySuite({ source: "cron", force });

    const status = outcome.skipped
      ? 200
      : outcome.passed
        ? 200
        : 500;

    return NextResponse.json(
      {
        ok: outcome.passed || outcome.skipped,
        runId: outcome.runId,
        skipped: outcome.skipped,
        skipReason: outcome.skipReason,
        passed: outcome.passed,
        envReady: outcome.envReport.readyForAutoRun,
        missingRequired: outcome.envReport.missingRequired,
        results: outcome.results,
        startedAt: outcome.startedAt,
        finishedAt: outcome.finishedAt,
      },
      { status },
    );
  } catch (e) {
    logger.error("Cron evolution-audio-daily-tests falhou", {
      feature: "api/cron/evolution-audio-daily-tests",
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro interno." },
      { status: 500 },
    );
  }
}
