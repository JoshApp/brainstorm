// Shared "headbob" state for first-person viewmodels (sword, lamp,
// offhand). Each viewmodel reads getBob() in its own per-frame update
// and adds the offset on top of its idle position.
//
// Why shared: all three viewmodels are hands attached to the same
// invisible body. They should sway in lockstep, not at independent
// phases.
//
// Design notes:
//   - Vertical bob runs at 2× the horizontal sway frequency, matching
//     a real walk cycle (you bob DOWN twice per stride — once per
//     footfall).
//   - Intensity eases toward the move-magnitude target so starting
//     and stopping don't snap on/off.
//   - Phase only advances while the player is actually moving;
//     standing still locks the viewmodels in place rather than
//     drifting through a sine curve.

const BOB_FREQ = 5.5;       // Hz — feels like a brisk delver walk
const BOB_LIFT = 0.020;     // metres of peak vertical offset
const BOB_SWAY = 0.014;     // metres of peak horizontal offset
const BOB_TILT = 0.05;      // radians of peak roll
const BLEND_RATE = 7;       // 1/sec exponential toward target intensity

let phase = 0;
let intensity = 0;
let target = 0;

/** Called once per frame from main with normalized move magnitude (0..1). */
export function setBobTarget(t: number) {
  target = Math.max(0, Math.min(1, t));
}

/** Advance the bob state. Use realDt — bob should keep its rhythm
 *  during hit-pause / slow-mo, otherwise the hands "stutter." */
export function updateBob(dt: number) {
  if (target > 0.01) phase += dt * BOB_FREQ * 2 * Math.PI;
  const k = 1 - Math.exp(-BLEND_RATE * dt);
  intensity += (target - intensity) * k;
}

export interface BobOffset {
  x: number;
  y: number;
  rotZ: number;
}

const scratch: BobOffset = { x: 0, y: 0, rotZ: 0 };

/** Current bob offset, scaled by smoothed intensity. Shared scratch
 *  object — callers should read it and apply, not retain. */
export function getBob(): BobOffset {
  scratch.x = Math.cos(phase) * BOB_SWAY * intensity;
  scratch.y = Math.sin(phase * 2) * BOB_LIFT * intensity;
  scratch.rotZ = Math.sin(phase) * BOB_TILT * intensity;
  return scratch;
}
