// Live run recorder — captures a real play session as a tape, allocation-free.
//
// PERFORMANCE: this is the whole reason for the typed-buffer design. The naive
// recorder pushes a small Intent OBJECT per fixed step (~240 allocations/sec →
// GC churn). Instead each step writes 8 numbers into a pre-grown Float32Array —
// pure index writes, ZERO garbage on the hot path. And it sits in the SIM step
// (CPU), never the render/GPU path, so it can't cost frames. When not recording,
// captureStep() is a single branch and returns immediately — zero cost.
//
// Recording is meaningful only under the fixed-step loop (?fixedstep=1): a tape
// is one intent per fixed 1/60s step, so it replays in the stepper exactly. The
// capture point is inside the input-camera system, right after input resolves
// and before the camera consumes the look delta.

import type { Intent } from './intent';
import type { Tape } from './tape';
import { peekAttackPressed } from '../controls/attack-input';
import { peekDash } from '../controls/dash-input';

const FLOATS_PER_STEP = 8; // moveX, moveY, lookDx, lookDy, attack, dodgeX, dodgeY, dodgeFlag

class RunRecorder {
  private buf: Float32Array;
  private steps = 0;
  constructor(readonly seed: number, capacitySteps = 8192) {
    this.buf = new Float32Array(capacitySteps * FLOATS_PER_STEP);
  }

  /** Append one step. Allocation-free: index writes into the typed buffer; the
   *  only growth is an occasional (amortized O(1)) doubling. */
  record(
    moveX: number, moveY: number, lookDx: number, lookDy: number,
    attack: boolean, dodgeX: number, dodgeY: number, hasDodge: boolean,
  ): void {
    if ((this.steps + 1) * FLOATS_PER_STEP > this.buf.length) {
      const next = new Float32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    let i = this.steps * FLOATS_PER_STEP;
    const b = this.buf;
    b[i++] = moveX; b[i++] = moveY; b[i++] = lookDx; b[i++] = lookDy;
    b[i++] = attack ? 1 : 0;
    b[i++] = dodgeX; b[i++] = dodgeY; b[i] = hasDodge ? 1 : 0;
    this.steps++;
  }

  get length(): number {
    return this.steps;
  }

  /** Decode the buffer into a replayable Tape (done once, off the hot path,
   *  when the run ends and the tape is needed). */
  toTape(): Tape {
    const frames: Intent[] = new Array(this.steps);
    const b = this.buf;
    for (let s = 0; s < this.steps; s++) {
      const i = s * FLOATS_PER_STEP;
      frames[s] = {
        move: [b[i], b[i + 1]],
        look: [b[i + 2], b[i + 3]],
        attack: b[i + 4] === 1,
        dodge: b[i + 7] === 1 ? [b[i + 5], b[i + 6]] : null,
      };
    }
    return { seed: this.seed, frames, label: 'live' };
  }
}

let active: RunRecorder | null = null;

export function startRecording(seed: number): void {
  active = new RunRecorder(seed >>> 0);
}

/** Finish recording and return the tape (or null if not recording). */
export function stopRecording(): Tape | null {
  const tape = active ? active.toTape() : null;
  active = null;
  return tape;
}

export function isRecording(): boolean {
  return active !== null;
}

export function recordedSteps(): number {
  return active ? active.length : 0;
}

// The most recently COMPLETED run's tape — held after death so the backend can
// pick it up and submit it (seed + inputs) for server-side verification.
let lastRunTape: Tape | null = null;

/** Stop recording and hold the finished tape for submission. Returns it too. */
export function finishRun(): Tape | null {
  const tape = stopRecording();
  if (tape) lastRunTape = tape;
  return tape;
}

/** The held finished-run tape (without clearing it). The leaderboard submission
 *  path reads this on death alongside the claimed score. */
export function peekLastRunTape(): Tape | null {
  return lastRunTape;
}

/** Take and clear the held tape (after it's been submitted). */
export function takeLastRunTape(): Tape | null {
  const t = lastRunTape;
  lastRunTape = null;
  return t;
}

/** Capture this fixed step's resolved intent. Called from the input-camera
 *  system AFTER input.tickInput() (so move/look are populated) and BEFORE
 *  updateCamera() consumes the look delta. A no-op branch when not recording. */
export function captureStep(input: {
  moveX: number; moveY: number; lookDx: number; lookDy: number;
}): void {
  if (!active) return;
  const dodge = peekDash();
  active.record(
    input.moveX, input.moveY, input.lookDx, input.lookDy,
    peekAttackPressed(),
    dodge ? dodge.dx : 0, dodge ? dodge.dy : 0, dodge !== null,
  );
}
