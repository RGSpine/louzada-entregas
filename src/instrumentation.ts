/**
 * Next.js Instrumentation - carrega Sentry no servidor e edge.
 * Erros de Server Components, proxy são capturados via onRequestError.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { startEvolutionAudioDailyScheduler } = await import(
      "./lib/evolution-audio-daily/scheduler"
    );
    startEvolutionAudioDailyScheduler();
    const { startFinanceDailyScheduler } = await import("./lib/finance-daily/scheduler");
    startFinanceDailyScheduler();
    const { registerShowcaseAgendaRefresh } = await import(
      "./lib/marketplace/register-showcase-agenda-refresh"
    );
    registerShowcaseAgendaRefresh();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
