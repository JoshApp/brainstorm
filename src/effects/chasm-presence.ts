import * as THREE from 'three';
import { playChasmBreath } from '../audio/sfx';
import type { WalkableRect } from '../level/types';

// Chasm presence — the deep is AUDIBLE. While the player lingers near a
// void's rim, the chasm occasionally exhales (playChasmBreath, a low
// 3s breath positioned at the nearest rim point). Sparse by design:
// one breath, then a long random silence, so it stays an event the
// player half-doubts they heard — never a loop the ear tunes out.
//
// Floors without voids cost one early-return per frame.

const NEAR_M = 5.0;          // player must be this close to a rim to hear it
const FIRST_DELAY_S = 5;     // settle-in time after floor load
const GAP_MIN_S = 14;        // silence between breaths (min)
const GAP_RAND_S = 18;       // + up to this much more
const RETRY_S = 2.5;         // re-check cadence while too far away

let voids: WalkableRect[] = [];
let countdown = 0;

/** Call on floor load with the level's void rects (or undefined). */
export function initChasmPresence(v: WalkableRect[] | undefined): void {
  voids = v ?? [];
  countdown = FIRST_DELAY_S + Math.random() * GAP_RAND_S * 0.5;
}

/** Per-frame. Uses real dt; call only while the world is unpaused so a
 *  menu doesn't fill with whispers. */
export function tickChasmPresence(camera: THREE.Camera, dt: number): void {
  if (voids.length === 0) return;
  countdown -= dt;
  if (countdown > 0) return;

  // Nearest point on any void rect (clamp player XZ into the rect).
  const px = camera.position.x, pz = camera.position.z;
  let best: { x: number; z: number; d2: number } | null = null;
  for (const v of voids) {
    const cx = Math.max(v.x - v.w / 2, Math.min(v.x + v.w / 2, px));
    const cz = Math.max(v.z - v.d / 2, Math.min(v.z + v.d / 2, pz));
    const d2 = (cx - px) * (cx - px) + (cz - pz) * (cz - pz);
    if (!best || d2 < best.d2) best = { x: cx, z: cz, d2 };
  }
  if (!best || best.d2 > NEAR_M * NEAR_M) {
    countdown = RETRY_S;
    return;
  }
  // Breathe from slightly below the rim — the sound has a floor under it.
  playChasmBreath({ x: best.x, y: -1.2, z: best.z });
  countdown = GAP_MIN_S + Math.random() * GAP_RAND_S;
}
