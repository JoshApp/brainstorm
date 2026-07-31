import { on } from '../broadcast/event-bus';
import { registerSimReset } from '../engine/sim-state';
import { getCount } from '../player/inventory';
import { KEY_ID } from '../content/drop-tables';

// KEY PROGRESS — a per-run latch: has the player had a key available yet?
//
// Used to gate KEYED events (a locked gold chest) so one can't appear before
// the run has produced its first key — you should never meet a chamber you
// can't open before you've had a real chance at a key (Josh: "the first event
// that needs a key can't appear unless the first key dropped"). Once a key has
// been seen, the latch stays set for the run even if you spend the key.

let seenKey = false;

// A key entering the bag (auto-pickup fires item:picked-up) trips the latch.
on((e) => { if (e.type === 'item:picked-up' && e.itemId === KEY_ID) seenKey = true; });

// Fresh run wipes it (sim reset runs at run start / teleport — see sim-state).
registerSimReset(() => { seenKey = false; });

/** True once a key has been available this run — either seen picked up, or
 *  currently held (covers a resumed run hydrated straight into keys). */
export function hasSeenKey(): boolean {
  return seenKey || getCount(KEY_ID) > 0;
}
