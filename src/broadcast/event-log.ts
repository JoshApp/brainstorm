import { on, type GameEvent } from './event-bus';

// Append-only event log — the Phase-4 (async multiplayer) foundation.
//
// The event bus is fire-and-forget: handlers react, nothing is recorded.
// Phase 4 needs an event-SOURCED record (deaths → bloodstains, run → epitaph,
// ghost playback). Since GameEvent is already plain serializable data, this
// just subscribes to the bus and keeps a timestamped, capped, in-memory log.
// Phase 4 swaps the sink for a SpacetimeDB writer; nothing else has to change.
//
// Kept OFF the hot path: a bounded ring (drops oldest) so a long run can't
// grow it without limit. Not persisted here — that's Phase 4's job.

export interface LoggedEvent {
  /** ms since page load (performance.now) — monotonic, serializable. */
  t: number;
  event: GameEvent;
}

const MAX_EVENTS = 2000;
const log: LoggedEvent[] = [];
let installed = false;

/** Begin recording bus events into the log. Idempotent. */
export function initEventLog(): void {
  if (installed) return;
  installed = true;
  on((event) => {
    log.push({ t: Math.round(performance.now()), event });
    if (log.length > MAX_EVENTS) log.shift();
  });
}

/** Snapshot of the recorded events (newest last). */
export function getEventLog(): readonly LoggedEvent[] {
  return log;
}

/** Drop all recorded events — e.g. at the start of a fresh run. */
export function clearEventLog(): void {
  log.length = 0;
}
