// Lightweight, privacy-respecting telemetry — for the public launch, so we can
// see WHAT BREAKS on devices we don't own and WHERE players bounce, without a
// heavyweight SDK or any PII.
//
// Provider-agnostic: events POST (sendBeacon, falling back to keepalive fetch)
// to TELEMETRY_ENDPOINT as plain JSON { event, props, session, t, ua }. Point it
// at a Cloudflare Worker, a SpacetimeDB reducer, an analytics collector — your
// choice. TELEMETRY_ENDPOINT is BLANK by default = fully OFF: no listeners, no
// network, nothing ships until an endpoint is set (same discipline as the
// community link).
//
// Privacy: an anonymous random session id (localStorage, NOT tied to the
// player's account/identity), Do-Not-Track honoured, no cookies, no PII beyond
// the user-agent string (standard for crash triage). Errors are throttled so a
// per-frame exception can't flood the endpoint. Telemetry must NEVER throw into
// the game — every path is wrapped.

const TELEMETRY_ENDPOINT = ''; // e.g. 'https://collect.example.workers.dev'

const MAX_ERRORS = 8; // per page load — enough to spot a pattern, not a flood
let enabled = false;
let session = '';
let errorsSent = 0;

/** Wire global error capture + enable event sending. No-op unless an endpoint
 *  is configured and the user hasn't set Do-Not-Track. Call once at boot. */
export function initTelemetry(): void {
  if (!TELEMETRY_ENDPOINT) return; // unconfigured → completely inert
  if (navigator.doNotTrack === '1' || (navigator as { msDoNotTrack?: string }).msDoNotTrack === '1') return;
  enabled = true;
  session = loadSession();
  window.addEventListener('error', (e) => {
    reportError(e.message, e.filename, e.lineno, (e.error as Error | undefined)?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    reportError(String(r?.message ?? r), undefined, undefined, r?.stack);
  });
}

/** Record a funnel event (boot, run_start, death, …). Cheap no-op when off. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  if (!enabled) return;
  send(event, props);
}

function reportError(message: string, file?: string, line?: number, stack?: string): void {
  if (!enabled || errorsSent >= MAX_ERRORS) return;
  errorsSent++;
  send('error', { message, file, line, stack: stack?.slice(0, 1200) });
}

function send(event: string, props: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify({ event, props, session, t: Date.now(), ua: navigator.userAgent });
    if (navigator.sendBeacon) navigator.sendBeacon(TELEMETRY_ENDPOINT, payload);
    else void fetch(TELEMETRY_ENDPOINT, { method: 'POST', body: payload, keepalive: true });
  } catch {
    /* telemetry must never break the game */
  }
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
