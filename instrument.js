// instrument.js — Sentry must be initialized before anything else.
// Imported as the very first statement in server.js.
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://dbe7cfa9f23ffb8c8de9054f16e598f6@o4511167039733760.ingest.us.sentry.io/4511167049302016",
  environment: process.env.NODE_ENV || "development",
  sendDefaultPii: true,
  // Capture 10% of transactions for performance monitoring in production.
  // Increase to 1.0 (100%) temporarily when debugging performance issues.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});
