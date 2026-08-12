import { CONFIG } from '../config';
import type { SwingPhase } from './swing-state';

// Player attack COMMITMENT — how much movement/turn agency you keep mid-swing,
// and whether a dash can cancel out. Extracted as a pure function so the feel is
// testable without a camera or a frame loop, plus a thin module-state cache the
// frame publishes once per tick (set from the swing phase + progress + weapon
// weight) and the camera / dash systems read. Same getter/setter pattern as the
// rest of the project — keeps camera.ts and the dash step decoupled from the
// viewmodel.
//
// The model (Elden Ring-ish) is an ARC, not a flat tax: a swing is
// free → commit → STRIKE → release → free. Commitment EASES IN as you wind up
// and EASES OUT as you recover, instead of slamming to a floor and holding it
// the whole phase. So the long tail of a heavy weapon's recover no longer feels
// like wading through mud — the momentum carries through, then you get control
// back. The STRIKE is the one hard-committed instant: agency bottoms out AND
// dash is locked (you eat the active frames).
//
// The recover release is a DECAY, not a linear ramp (RECOVER_FALLOFF). Linear
// meant a hammer — whose recover is ~2x a sword's — spent that entire long tail
// measurably slowed, which reads as one continuous slow rather than as weight.
// The felt weight lives in the BITE at the moment the strike ends; past that,
// dragging it out just costs the player agency without saying anything. With the
// decay you still eat the full bite, then get most of your footing back in the
// first third of the recover and the rest is nearly free.
//
// Two axes, decoupled on purpose:
//   - MOVE is throttled hard — planting your feet is what sells WEIGHT.
//   - TURN is throttled GENTLY — on a phone your look-drag IS your aim, and
//     choking it reads as a laggy/sticky camera, not as a heavy weapon. Turn
//     only really bites at the brief strike.

export interface SwingAgency {
  /** Move-speed multiplier (1 = full, 0 = rooted). */
  moveMul: number;
  /** Turn-rate (look sensitivity) multiplier (1 = full, 0 = can't turn). */
  turnMul: number;
  /** True only during the committed strike frames — dash can't cancel it. */
  dashLocked: boolean;
}

const FREE: SwingAgency = { moveMul: 1, turnMul: 1, dashLocked: false };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Agency at a given commitment DEPTH (0 = free, 1 = at the configured floor).
// depth folds together weapon weight and where we are in the swing arc.
function atDepth(moveFloor: number, turnFloor: number, depth: number, dashLocked: boolean): SwingAgency {
  return {
    moveMul: lerp(1, moveFloor, depth),
    turnMul: lerp(1, turnFloor, depth),
    dashLocked,
  };
}

/** Pure: agency for a given swing phase + weapon commitment (0 = weightless, no
 *  lock; 1 = fully committed, reaches the configured per-phase floors) + how far
 *  through the phase we are (0..1). The phase progress shapes the arc:
 *    - windup  eases commitment IN  (depth 0 → c) — you can still adjust early,
 *      you're locked in by the time it releases into the strike.
 *    - strike  holds full commitment (depth c) — the moment of truth.
 *    - recover DECAYS commitment out (depth c → 0, front-loaded by
 *      RECOVER_FALLOFF) — you eat the bite as the strike ends, then get your
 *      footing back fast instead of wading through the whole tail. An exponent
 *      of 1 restores the old linear ramp.
 *  Idle = full freedom. */
export function swingAgency(phase: SwingPhase, commitment: number, progress = 0): SwingAgency {
  const c = Math.max(0, Math.min(1, commitment));
  const t = Math.max(0, Math.min(1, progress));
  const K = CONFIG.COMMITMENT;
  switch (phase) {
    case 'windup':
      return atDepth(K.WINDUP_MOVE, K.WINDUP_TURN, c * t, false);
    case 'strike':
      return atDepth(K.STRIKE_MOVE, K.STRIKE_TURN, c, true);
    case 'recover':
      return atDepth(K.RECOVER_MOVE, K.RECOVER_TURN, c * Math.pow(1 - t, K.RECOVER_FALLOFF), false);
    default:
      return FREE;
  }
}

let current: SwingAgency = FREE;

/** Publish this frame's agency from the live swing phase + progress + equipped
 *  weapon's commitment. Called once per frame BEFORE the camera + dash systems
 *  read it. */
export function updateSwingAgency(phase: SwingPhase, commitment: number, progress: number): void {
  current = swingAgency(phase, commitment, progress);
}

export function getMoveMul(): number { return current.moveMul; }
export function getTurnMul(): number { return current.turnMul; }
export function isDashLocked(): boolean { return current.dashLocked; }
export function resetSwingAgency(): void { current = FREE; }
