import { CONFIG } from '../config';
import type { SwingPhase } from './swing-state';

// Player attack COMMITMENT — how much movement/turn agency you keep mid-swing,
// and whether a dash can cancel out. Extracted as a pure function so the feel is
// testable without a camera or a frame loop, plus a thin module-state cache the
// frame publishes once per tick (set from the swing phase + weapon weight) and
// the camera / dash systems read. Same getter/setter pattern as the rest of the
// project — keeps camera.ts and the dash step decoupled from the viewmodel.
//
// The model (Elden Ring-ish): a swing costs you agency, scaled by weapon
// weight. The STRIKE is the committed window — agency bottoms out AND dash is
// locked (you eat the active frames). windup + recovery let you dash-cancel.

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

/** Pure: agency for a given swing phase + weapon commitment (0 = weightless, no
 *  lock; 1 = fully committed, reaches the configured per-phase floors). Idle =
 *  full freedom. */
export function swingAgency(phase: SwingPhase, commitment: number): SwingAgency {
  const c = Math.max(0, Math.min(1, commitment));
  const K = CONFIG.COMMITMENT;
  switch (phase) {
    case 'windup':
      return { moveMul: lerp(1, K.WINDUP_MOVE, c), turnMul: lerp(1, K.WINDUP_TURN, c), dashLocked: false };
    case 'strike':
      return { moveMul: lerp(1, K.STRIKE_MOVE, c), turnMul: lerp(1, K.STRIKE_TURN, c), dashLocked: true };
    case 'recover':
      return { moveMul: lerp(1, K.RECOVER_MOVE, c), turnMul: lerp(1, K.RECOVER_TURN, c), dashLocked: false };
    default:
      return FREE;
  }
}

let current: SwingAgency = FREE;

/** Publish this frame's agency from the live swing phase + equipped weapon's
 *  commitment. Called once per frame BEFORE the camera + dash systems read it. */
export function updateSwingAgency(phase: SwingPhase, commitment: number): void {
  current = swingAgency(phase, commitment);
}

export function getMoveMul(): number { return current.moveMul; }
export function getTurnMul(): number { return current.turnMul; }
export function isDashLocked(): boolean { return current.dashLocked; }
export function resetSwingAgency(): void { current = FREE; }
