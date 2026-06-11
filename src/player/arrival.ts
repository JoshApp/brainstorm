import * as THREE from 'three';
import { CONFIG } from '../config';

// ── FLOOR ARRIVAL — rise from the bonfire ────────────────────────────
//
// Every floor begins seated: the fade lifts on a low camera beside the
// threshold bonfire, and the player STANDS over ~1.6s into eye height.
// One small ritual that stitches the descent: take the stairs → wake
// at the fire below. (The bonfire itself is placed by the builder
// beside every spawn; safe rooms author their own.)

const SIT_HEIGHT = 0.92;
const DURATION = 1.6;

let t = -1;   // -1 = idle
let offset = 0;

export function beginArrival(): void {
  t = 0;
  offset = SIT_HEIGHT - CONFIG.PLAYER_HEIGHT;
}

/** Advance the rise clock. The camera system applies the offset —
 *  movement locks eye height every frame, so writing camera.y from
 *  here would be stomped within the same frame. */
export function tickArrival(_camera: THREE.Camera, dt: number): void {
  if (t < 0) return;
  t += dt;
  const k = Math.min(1, t / DURATION);
  // smoothstep ease — slow off the seat, settles gently at standing.
  const e = k * k * (3 - 2 * k);
  offset = (SIT_HEIGHT - CONFIG.PLAYER_HEIGHT) * (1 - e);
  if (k >= 1) { t = -1; offset = 0; }
}

/** Negative while rising from the bonfire seat; 0 once standing. */
export function getArrivalHeightOffset(): number {
  return offset;
}
