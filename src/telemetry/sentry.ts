// Sentry backbone — the error monitor behind the custom crash layer.
//
// Sentry brings what a raw beacon can't: dedup/grouping (500 players, one
// issue), symbolication (via the hidden source maps uploaded at build, tied to
// __BUILD_SHA__), release/regression tracking, and alerting. The custom layer
// (telemetry.ts + crash-overlay.ts) feeds it the value-add: DELVE breadcrumbs,
// the run context, and the DETERMINISTIC REPRO TAPE attached to fatals so a
// crash replays exactly in the stepper.
//
// SENTRY_DSN is BLANK by default = Sentry off; telemetry falls back to the
// beacon + clipboard-report path. The DSN is NOT secret (it's a client value) —
// paste your project's DSN to activate. Source-map UPLOAD is separate (build-
// time, gated on SENTRY_AUTH_TOKEN in CI — see vite.config.ts).

import * as Sentry from '@sentry/browser';

declare const __BUILD_SHA__: string;

const SENTRY_DSN = ''; // e.g. 'https://abc123@o0.ingest.sentry.io/0'

let active = false;

export function isSentryActive(): boolean { return active; }

/** Init Sentry if a DSN is set and Do-Not-Track is off. `getContext` is called
 *  on every event to attach the live DELVE context (seed/depth/gpu…). Returns
 *  whether Sentry took over error capture (so telemetry skips its own beacon
 *  listeners and routes through here instead). */
export function initSentry(getContext: () => Record<string, unknown>): boolean {
  if (!SENTRY_DSN) return false;
  if (navigator.doNotTrack === '1') return false;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: __BUILD_SHA__,
      sendDefaultPii: false,   // no IP / no PII — anonymous crash triage only
      tracesSampleRate: 0,     // errors only; no perf tracing overhead in a game
      beforeSend(event) {
        try { event.contexts = { ...(event.contexts ?? {}), delve: getContext() }; } catch { /* keep the event */ }
        return event;
      },
    });
    active = true;
  } catch {
    active = false;
  }
  return active;
}

export function sentryBreadcrumb(category: string, message: string): void {
  if (!active) return;
  try { Sentry.addBreadcrumb({ category, message, level: 'info' }); } catch { /* ignore */ }
}

/** Capture an exception with the run context + (for fatals) the repro tape as a
 *  downloadable attachment, so the exact session can be replayed. */
export function sentryCaptureError(e: Error, context: Record<string, unknown>, repro: unknown, fatal: boolean): void {
  if (!active) return;
  try {
    Sentry.withScope((scope) => {
      scope.setContext('delve', context);
      scope.setLevel(fatal ? 'fatal' : 'error');
      if (repro) { try { scope.addAttachment({ filename: 'repro.json', data: JSON.stringify(repro) }); } catch { /* attachment optional */ } }
      Sentry.captureException(e);
    });
  } catch { /* never throw into the game */ }
}

/** A player-initiated crash/feedback report → a Sentry message with the note +
 *  context + repro tape attached. */
export function sentryCaptureReport(report: Record<string, unknown>): void {
  if (!active) return;
  try {
    Sentry.withScope((scope) => {
      scope.setContext('delve', (report.context as Record<string, unknown>) ?? {});
      if (report.note) scope.setExtra('note', report.note);
      if (report.error) scope.setExtra('error', report.error);
      if (report.repro) { try { scope.addAttachment({ filename: 'repro.json', data: JSON.stringify(report.repro) }); } catch { /* optional */ } }
      Sentry.captureMessage('player crash report', 'error');
    });
  } catch { /* ignore */ }
}
