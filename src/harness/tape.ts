// A run, encoded. The whole point of the tape foundation: a run IS its seed
// plus the per-frame intent stream — NOT a dump of world state. The world
// (enemy positions, HP, AI, loot) is never stored; it's recomputed by
// re-running the tape from the seed. So a run is a few KB, it's perfectly
// reproducible, and it's the same artifact Phase 4 wants for ghosts/bloodstains.
//
//   seek(N)   = seed; run N fixed steps feeding tape.frames[0..N]
//   fork(K)   = seek(K), then feed NEW intents (a different branch)
//   compare   = run two tapes, diff the per-frame digests
//
// Pure data + pure helpers — no engine imports, so a headless Node runner or
// the browser stepper can both own it.

import type { Intent } from './intent';
import { cloneIntent } from './intent';

export interface Tape {
  /** The run seed — seeds gameRng before the first step. */
  seed: number;
  /** One intent per fixed step, in order. frames.length = run length. */
  frames: Intent[];
  /** Optional human label / provenance. */
  label?: string;
}

/** Accumulates intents during a recorded run. */
export class TapeRecorder {
  private frames: Intent[] = [];
  constructor(private seed: number, private label?: string) {}

  /** Capture this frame's intent (deep-copied so later bus mutation can't
   *  rewrite history). Call once per fixed step, after the source sets it. */
  record(intent: Intent): void {
    this.frames.push(cloneIntent(intent));
  }

  get length(): number {
    return this.frames.length;
  }

  /** Freeze into an immutable-ish Tape. */
  finish(): Tape {
    return { seed: this.seed, frames: this.frames.slice(), label: this.label };
  }
}

/** Frame source for replay: returns the recorded intent for frame i, or
 *  NEUTRAL past the end (a tape can be replayed longer than it was recorded —
 *  the world just keeps simulating with no input). */
export function tapeFrame(tape: Tape, i: number): Intent | undefined {
  return tape.frames[i];
}

/** Round-trip a tape through JSON (passing between page loads, saving to disk,
 *  shipping as a ghost). Tapes are plain data, so this is lossless. */
export function serializeTape(tape: Tape): string {
  return JSON.stringify(tape);
}

export function deserializeTape(json: string): Tape {
  const t = JSON.parse(json) as Tape;
  if (typeof t.seed !== 'number' || !Array.isArray(t.frames)) {
    throw new Error('[tape] malformed: needs { seed:number, frames:Intent[] }');
  }
  return t;
}
