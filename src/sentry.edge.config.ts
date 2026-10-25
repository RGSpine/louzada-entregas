/**
 * Sentry - inicialização no Edge Runtime.
 * Só envia eventos se NEXT_PUBLIC_SENTRY_DSN estiver definido.
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
    environment: process.env.NODE_ENV,
  });
}
