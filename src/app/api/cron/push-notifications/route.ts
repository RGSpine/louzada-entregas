import { NextRequest, NextResponse } from "next/server";
import { runPushNotificationDispatch } from "@/lib/push-notifications/dispatch";
import { isWebPushConfigured } from "@/lib/web-push/send";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Cron: lembretes de agenda (24h / em breve / 1h) + digests matinais
 * (agenda do dia + action points) às 8h BRT.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "vapid_not_configured" });
  }

  try {
    const result = await runPushNotificationDispatch();
    logger.info("Cron push-notifications concluído", {
      feature: "api/cron/push-notifications",
      ...result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error("Cron push-notifications falhou", {
      feature: "api/cron/push-notifications",
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro interno." },
      { status: 500 },
    );
  }
}
