// Shared viewmodel motion state. Each held viewmodel (sword, lantern,
// offhand) reads its own per-viewmodel helper from here so they all
// move in lockstep against the same stride cycle but with the
// character appropriate to that prop:
//
//   sword     → vertical BOP (down/forward per footfall) + tilt
//   lantern   → pendulum SWING from its handle
//   offhand   → gentle vertical lift only
//
// Two phases run independently:
//
//   walkPhase  advances only while moving (intensity > ~0)
//   idlePhase  always advances — produces the breath / micro-sway
//              that keeps a stationary view from looking painted on.
//
// Both phases feed multi-sine combinations at incommensurable ratios
// so the motion never lines up into an obvious loop.

const WALK_FREQ = 1.8;        // Hz — one full stride cycle. ~2 footfalls / sec.
const IDLE_FREQ = 0.35;       // Hz — breath / hand microadjust.
const BLEND_RATE = 4;         // 1/sec exponential toward target intensity

let walkPhase = 0;
let idlePhase = 0;
let intensity = 0;
let target = 0;
// Liveness blends to 0 when the player loses control (death). It gates the
// IDLE sway — the constant micro-motion that keeps a standing view from
// looking painted on. A corpse should be painted on. Walk motion is already
// killed by `intensity` (target goes to 0 when not in control), so liveness
// only needs to suppress the idle terms.
let liveness = 1;

/** Called once per frame from main with normalized move magnitude (0..1). */
export function setBobTarget(t: number) {
  target = Math.max(0, Math.min(1, t));
}

/** Advance bob state. Use realDt so the rhythm doesn't stutter through
 *  slow-mo. Idle phase always advances; walk phase only when moving.
 *
 *  `active` = the player has control (game-mode 'playing'). When false
 *  (dying/dead), walk intensity AND idle sway both blend to rest so the
 *  viewmodel settles instead of bobbing through the death collapse. */
export function updateBob(dt: number, active: boolean = true) {
  idlePhase += dt * IDLE_FREQ * 2 * Math.PI;
  const eff = active ? target : 0;
  if (eff > 0.01) walkPhase += dt * WALK_FREQ * 2 * Math.PI;
  const k = 1 - Math.exp(-BLEND_RATE * dt);
  intensity += (eff - intensity) * k;
  liveness += ((active ? 1 : 0) - liveness) * k;
}

// Two-sine helper at incommensurable ratio — neither phase repeats
// cleanly against the other so the visual reads "organic" rather
// than "sinusoid".
function dualSine(phase: number, ratio: number, offset: number): number {
  return Math.sin(phase) * 0.7 + Math.sin(phase * ratio + offset) * 0.3;
}

export interface SwordOffset {
  x: number;
  y: number;
  rotZ: number;
}

const swordScratch: SwordOffset = { x: 0, y: 0, rotZ: 0 };

/** Sword: vertical bop on each footfall (2× walk frequency) + tiny
 *  horizontal sway. Idle adds a small drift so the blade isn't dead
 *  still while standing. */
export function getSwordOffset(): SwordOffset {
  const walkY  = dualSine(walkPhase * 2, 1.31, 0.4) * 0.014 * intensity;
  const walkX  = dualSine(walkPhase, 1.41, 0.0)    * 0.004 * intensity;
  const walkRZ = dualSine(walkPhase, 1.27, 0.2)    * 0.020 * intensity;
  const idleY  = dualSine(idlePhase, 1.31, 0.3)    * 0.002 * liveness;
  const idleRZ = dualSine(idlePhase * 1.13, 1.41, 0.7) * 0.005 * liveness;
  swordScratch.x = walkX;
  swordScratch.y = walkY + idleY;
  swordScratch.rotZ = walkRZ + idleRZ;
  return swordScratch;
}

/** Lantern: pendulum SWING — radians, applied as rotation Z on the
 *  HINGE (a parent group positioned at the lantern's handle). The
 *  body is a child offset down from the hinge, so when the hinge
 *  rotates the body automatically traces the pendulum arc.
 *
 *  Walking drives the big arc, idle adds a constant micro-sway so the
 *  lamp never reads as dead-still. Opposite phase from the sword bop
 *  so when the player dips into a footfall, the lantern is rising. */
export function getLanternSwing(): number {
  const walkAng = dualSine(walkPhase + Math.PI, 1.37, 0.5) * 0.10 * intensity;
  const idleAng = dualSine(idlePhase, 1.41, 0.2) * 0.020 * liveness;
  return walkAng + idleAng;
}

export interface OffhandOffset {
  x: number;
  y: number;
  rotZ: number;
}

const offhandScratch: OffhandOffset = { x: 0, y: 0, rotZ: 0 };

/** Generic offhand (shield etc.): subtle vertical lift only. Shields
 *  aren't swung — they should feel braced, not animated. */
export function getOffhandOffset(): OffhandOffset {
  const walkY = dualSine(walkPhase * 2, 1.21, 0.2) * 0.008 * intensity;
  const idleY = dualSine(idlePhase * 1.2, 1.31, 0.1) * 0.002 * liveness;
  offhandScratch.x = 0;
  offhandScratch.y = walkY + idleY;
  offhandScratch.rotZ = 0;
  return offhandScratch;
}
