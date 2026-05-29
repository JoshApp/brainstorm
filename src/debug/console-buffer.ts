// Console ring buffer for the debug capture tool.
//
// Patches console.warn / console.error / window.onerror to keep the
// last N messages in memory so a debug capture can include "what went
// wrong right before I hit the glitch" — Three.js shader warnings,
// undefined-material errors, uncaught exceptions, etc.
//
// Installed SYNCHRONOUSLY at boot (from main.ts when ?debug=1) so it's
// active before any other module can throw. Cheap: a bounded array +
// two function wrappers. No-op until install() is called.

export interface BufferedLog {
  /** ms since install. */
  t: number;
  level: 'warn' | 'error';
  text: string;
}

const MAX = 30;
const buffer: BufferedLog[] = [];
let installed = false;
let installedAt = 0;

function push(level: 'warn' | 'error', args: unknown[]): void {
  const text = args.map(stringifyArg).join(' ');
  buffer.push({ t: Math.round(performance.now() - installedAt), level, text });
  if (buffer.length > MAX) buffer.shift();
}

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
}

/** Install the console patches + global error handlers. Idempotent. */
export function installConsoleBuffer(): void {
  if (installed) return;
  installed = true;
  installedAt = performance.now();

  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => { push('warn', args); origWarn(...args); };
  console.error = (...args: unknown[]) => { push('error', args); origError(...args); };

  window.addEventListener('error', (e) => {
    push('error', [`uncaught: ${e.message} @ ${e.filename}:${e.lineno}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('error', [`unhandled promise: ${stringifyArg(e.reason)}`]);
  });
}

/** Snapshot of the most recent logs (oldest first). Optionally only
 *  those within `sinceMs` of now — useful for "what happened in the
 *  last few seconds before I captured." */
export function getRecentLogs(sinceMs?: number): BufferedLog[] {
  if (sinceMs == null) return [...buffer];
  const cutoff = Math.round(performance.now() - installedAt) - sinceMs;
  return buffer.filter((l) => l.t >= cutoff);
}
