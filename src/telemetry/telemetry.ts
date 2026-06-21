// Lightweight, privacy-respecting telemetry + crash capture — for the public
// launch, so we can see WHAT BREAKS on devices we don't own and WHERE players
// bounce, without a heavyweight SDK or any PII.
//
// Two halves, deliberately decoupled:
//   - CAPTURE is ALWAYS ON. Breadcrumbs, crash context, and the full crash
//     report are built regardless of config, because the crash overlay's
//     copy-to-clipboard path is useful with ZERO backend (the player pastes the
//     diagnostic into Discord). Capture never throws into the game.
//   - SENDING is gated. Events/errors POST (sendBeacon) to TELEMETRY_ENDPOINT
//     only when it's set and Do-Not-Track is off. Blank endpoint = no network.
//
// Every report carries the build SHA (__BUILD_SHA__) so a crash is tied to the
// exact deploy. Provider-agnostic payload — point the endpoint at a Worker, a
// SpacetimeDB reducer, or an analytics collector.
//
// Privacy: anonymous random session id (NOT the player's account identity), DNT
// honoured, no cookies, UA only (standard for crash triage). Error sends are
// throttled so a per-frame exception can't flood.

declare const __BUILD_SHA__: string;

const TELEMETRY_ENDPOINT = ''; // e.g. 'https://collect.example.workers.dev'

const MAX_ERRORS = 8;          // network error sends per page load
const MAX_BREADCRUMBS = 40;    // recent-events ring buffer attached to crashes

let sending = false;
let session = '';
let errorsSent = 0;

interface Crumb { t: number; cat: string; msg: string; }
const breadcrumbs: Crumb[] = [];

/** Lazily-sampled crash context (seed, depth, device…), registered by the game
 *  so telemetry stays decoupled from game internals. Called when a report is
 *  built, never on the hot path. */
type ContextProvider = () => Record<string, unknown>;
let contextProvider: ContextProvider | null = null;
export function setCrashContext(fn: ContextProvider): void { contextProvider = fn; }

/** Wire global error capture + enable sending. Capture works regardless; only
 *  the network half gates on a configured endpoint + DNT. Call once at boot. */
export function initTelemetry(): void {
  session = loadSession();
  sending = !!TELEMETRY_ENDPOINT
    && navigator.doNotTrack !== '1'
    && (navigator as { msDoNotTrack?: string }).msDoNotTrack !== '1';
  window.addEventListener('error', (e) => captureError((e.error as Error) ?? new Error(e.message), false));
  window.addEventListener('unhandledrejection', (e) => captureError(toError(e.reason), false));
}

/** Drop a recent-events crumb (level loads, screen opens, funnel events). Always
 *  recorded for crash context; sending is separate. */
export function breadcrumb(cat: string, msg: string): void {
  breadcrumbs.push({ t: Date.now(), cat, msg });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

/** Record a funnel event (boot, run_start, death…). Also leaves a breadcrumb. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  breadcrumb('event', event);
  if (sending) send({ event, props: { ...props, ...safeContext() } });
}

/** Capture an error — breadcrumb always, network send when enabled+under quota.
 *  `fatal` only tags the event; the crash OVERLAY is shown by the caller. */
export function captureError(err: unknown, fatal: boolean): void {
  const e = toError(err);
  breadcrumb('error', e.message);
  if (sending && errorsSent < MAX_ERRORS) {
    errorsSent++;
    send({ event: fatal ? 'fatal' : 'error', props: { message: e.message, stack: e.stack?.slice(0, 1500), ...safeContext() } });
  }
}

/** Build the full diagnostic for a player-initiated crash/feedback report —
 *  build, error, context, breadcrumbs, plus any caller extras (the repro tape).
 *  This is the rich, deliberate report, distinct from the throttled auto-sends. */
export function buildReport(error: Error | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    build: __BUILD_SHA__,
    session,
    t: Date.now(),
    ua: navigator.userAgent,
    error: error ? { message: error.message, stack: error.stack } : undefined,
    context: safeContext(),
    breadcrumbs: breadcrumbs.slice(),
    ...extra,
  };
}

/** Send a full report. Tries the endpoint (normal fetch — the page isn't
 *  unloading, so no keepalive size cap), and ALWAYS copies to the clipboard as
 *  the zero-backend fallback so the player can paste it to the others. */
export async function sendReport(report: Record<string, unknown>): Promise<'sent' | 'copied' | 'failed'> {
  const json = JSON.stringify(report);
  let sent = false;
  if (sending) {
    try { await fetch(TELEMETRY_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json }); sent = true; } catch { /* fall through to clipboard */ }
  }
  let copied = false;
  try { await navigator.clipboard.writeText(json); copied = true; } catch { /* clipboard blocked */ }
  return sent ? 'sent' : copied ? 'copied' : 'failed';
}

function safeContext(): Record<string, unknown> {
  if (!contextProvider) return {};
  try { return contextProvider(); } catch { return {}; }
}

function send(body: { event: string; props: Record<string, unknown> }): void {
  try {
    const payload = JSON.stringify({
      ...body,
      session,
      t: Date.now(),
      build: __BUILD_SHA__,
      ua: navigator.userAgent,
      crumbs: breadcrumbs.slice(-12),
    });
    if (navigator.sendBeacon) navigator.sendBeacon(TELEMETRY_ENDPOINT, payload);
    else void fetch(TELEMETRY_ENDPOINT, { method: 'POST', body: payload, keepalive: true });
  } catch {
    /* telemetry must never break the game */
  }
}

function toError(r: unknown): Error {
  if (r instanceof Error) return r;
  const e = new Error(typeof r === 'string' ? r : JSON.stringify(r));
  return e;
}

function loadSession(): string {
  try {
    const k = 'delve:telemetry-session';
    let s = localStorage.getItem(k);
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(k, s);
    }
    return s;
  } catch {
    return 'nostore';
  }
}
