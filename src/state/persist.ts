// localStorage wrapper — one place for the "read/write JSON with a fallback,
// never throw, tolerate no-storage" pattern that ~20 files reimplement, and one
// registry of the keys so they stop being scattered magic strings.
//
// Every call is guarded: localStorage can be absent (SSR/headless), disabled
// (private mode), or full (quota). Persistence must NEVER break the game, so
// reads fall back and writes swallow — same contract the hand-rolled sites had.
//
// Adopt incrementally: new code uses this; existing sites migrate as touched.
// Sites with bespoke needs (versioned migrations, non-JSON tokens) can use the
// raw helpers or keep their own logic — this is a convenience, not a mandate.

/** The known localStorage keys. Reference these instead of raw strings so a
 *  rename is one edit and the full persisted surface is greppable in one place. */
export const KEYS = {
  meta: 'delve:meta',                     // meta-state (progress across runs)
  save: 'delve:save',                     // current run save
  settings: 'delve:settings',             // video/audio/control settings
  telemetryLog: 'delve:telemetry-log',    // offline balance event ring
  telemetrySession: 'delve:telemetry-session',
  playerProfile: 'delve:player-profile',  // AI behavioural profile
  bootGuard: 'delve:boot-guard',
  booted: 'delve:booted',
  devSnap: 'delve:dev-snap',
  gpuErrors: 'delve:gpu-errors',
  pendingLink: 'delve:pending-link',      // account-link intent
  stdbToken: 'delve:stdb-token',          // SpacetimeDB identity token
} as const;

/** Read + JSON-parse a key. Returns `fallback` on missing / parse error / no
 *  storage. Never throws. */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** JSON-stringify + write a key. Swallows quota / no-storage errors. Returns
 *  true iff the write landed. */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Read a raw string key (non-JSON: tokens, session ids). null on miss/no storage. */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string key. Swallows errors; returns true iff it landed. */
export function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. Never throws. */
export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* no storage — nothing to remove */
  }
}
