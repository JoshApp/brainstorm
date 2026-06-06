// Camera stumble — the off-balance lurch of a dodge you couldn't afford.
//
// A single smooth roll + forward-pitch + downward drop that peaks at mid-window
// and recovers, so an empty-bar stumble-dodge reads as losing your footing. This
// is deliberately NOT the jittery hit-shake (screen-shake.ts) — it's one
// directional lurch, like catching your balance. Triggered from dash.ts.
//
// Module-level mutable state, getter pattern. NOT persisted (reset on floor load).

import { CONFIG } from '../config';

let elapsed = Infinity;   // seconds into the current stumble (≥ duration = idle)
let dir = 1;              // ±1 roll direction, randomised per stumble

export interface StumbleOffset { roll: number; pitch: number; dip: number; }
const out: StumbleOffset = { roll: 0, pitch: 0, dip: 0 };

/** Kick a stumble lurch. Random roll direction so repeated stumbles don't all
 *  tilt the same way. */
export function stumble(): void {
  elapsed = 0;
  dir = Math.random() < 0.5 ? -1 : 1;
}

/** Advance in REAL time (steady through slow-mo / hit-pause). */
export function tickCameraStumble(realDt: number): void {
  if (elapsed < CONFIG.CAMERA_STUMBLE.DURATION_S) elapsed += realDt;
}

/** Current lurch offsets (roll/pitch radians, dip metres). All 0 when idle.
 *  Returns a shared object — read it, don't retain. */
export function getStumbleOffset(): StumbleOffset {
  const d = CONFIG.CAMERA_STUMBLE.DURATION_S;
  if (elapsed >= d) { out.roll = 0; out.pitch = 0; out.dip = 0; return out; }
  const s = Math.sin(Math.PI * (elapsed / d));   // 0 → 1 → 0 across the window
  out.roll = CONFIG.CAMERA_STUMBLE.ROLL * dir * s;
  out.pitch = CONFIG.CAMERA_STUMBLE.PITCH * s;
  out.dip = -CONFIG.CAMERA_STUMBLE.DIP * s;
  return out;
}

export function resetCameraStumble(): void {
  elapsed = Infinity;
}
