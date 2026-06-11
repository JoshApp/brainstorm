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

export function beginArrival(): void {
  t = 0;
}

export function tickArrival(camera: THREE.Camera, dt: number): void {
  if (t < 0) return;
  t += dt;
  const k = Math.min(1, t / DURATION);
  // smoothstep ease — slow at the seat, settles gently at standing.
  const e = k * k * (3 - 2 * k);
  camera.position.y = SIT_HEIGHT + (CONFIG.PLAYER_HEIGHT - SIT_HEIGHT) * e;
  if (k >= 1) t = -1;
}
