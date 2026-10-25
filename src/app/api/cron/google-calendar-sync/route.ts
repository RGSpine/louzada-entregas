import { NextRequest, NextResponse } from "next/server";
import { runBidirectionalSyncForAllLinkedUsers } from "@/lib/google-calendar-bidirectional";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Sync bidirecional Google Agenda para todos os profissionais com conta ligada.
 * Vercel Cron: GET com Authorization Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { processed, results } = await runBidirectionalSyncForAllLinkedUsers();

    const summary = {
      processed,
      totalImported: results.reduce((n, r) => n + r.import.imported, 0),
      totalUpdated: results.reduce((n, r) => n + r.import.updated, 0),
      totalPushed: results.reduce((n, r) => n + r.pushed, 0),
      totalPushFailed: results.reduce((n, r) => n + r.pushFailed, 0),
      skippedUsers: results.filter((r) => r.skipped).length,
    };

    logger.info("Cron google-calendar-sync concluído", {
      feature: "api/cron/google-calendar-sync",
      ...summary,
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    logger.error("Cron google-calendar-sync falhou", {
      feature: "api/cron/google-calendar-sync",
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro interno." },
      { status: 500 },
    );
  }
}
