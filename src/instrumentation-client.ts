/**
 * Sentry - inicialização no cliente (browser).
 * Next.js carrega este arquivo no client. Só envia eventos se NEXT_PUBLIC_SENTRY_DSN estiver definido.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryEnabled =
  Boolean(dsn) &&
  (process.env.NODE_ENV === "production" || process.env.SENTRY_ENABLE_DEV === "true");

if (sentryEnabled && dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NODE_ENV,
  });
}

// Instrumentação de navegação (traces de transição entre páginas)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
