import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { grantXp } from '../state/run-state';
import { emit } from '../broadcast/event-bus';

// XP wisps — additive sprites that burst out of a dying mob, hang for
// a beat, then home in on the player and absorb on contact. Each wisp
// grants 1 XP. The visible effect IS the XP — there are no abstract
// "+5 XP" popups; the player sees their kills literally flow into them.
//
// Two phases per wisp:
//   1. burst (≈0.18s): outward drift with drag, slight upward bias.
//   2. home (rest of lifetime): accelerate toward player chest height,
//      capped at maxSpeed, absorbed when within absorb radius.
//
// 30% of wisps are violet (the rest blue) so each kill looks like a
// little shower of mixed motes rather than a uniform blob.

interface Wisp {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  burstDuration: number;
}

const wisps: Wisp[] = [];
const tmp = new THREE.Vector3();

const ABSORB_RADIUS_SQ = 0.55 * 0.55;
const MAX_HOMING_SPEED = 14;
// playerPos is the CAMERA (eye level). Bias downward so wisps converge
// on the player's CHEST instead of above the head — feels like they're
// absorbed into the player rather than rising past them.
const HOMING_BIAS_Y = -0.4;

export function spawnXpWisps(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const violet = Math.random() < 0.3;
    const color = violet ? 0x9560ff : 0x40a0ff;
    const mat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(origin);
    // Small birth jitter — wisps don't all start exactly at the same
    // pixel, so the burst reads as a cluster, not a single bright blob.
    sp.position.x += (Math.random() - 0.5) * 0.25;
    sp.position.y += (Math.random() - 0.5) * 0.20;
    sp.position.z += (Math.random() - 0.5) * 0.25;
    sp.scale.setScalar(0.28 + Math.random() * 0.14);
    scene.add(sp);
    wisps.push({
      sprite: sp,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 1.6,
        0.4 + Math.random() * 0.6,
        (Math.random() - 0.5) * 1.6,
      ),
      age: 0,
      burstDuration: 0.16 + Math.random() * 0.10,
    });
  }
}

/** Per-frame tick. Needs the live player position so wisps can home. */
export function tickXpWisps(dt: number, playerPos: THREE.Vector3): void {
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    w.age += dt;

    if (w.age < w.burstDuration) {
      // Burst phase — outward drift with strong drag so it settles.
      w.sprite.position.addScaledVector(w.vel, dt);
      const drag = Math.pow(0.5, dt * 2);
      w.vel.x *= drag;
      w.vel.z *= drag;
      w.vel.y *= Math.pow(0.7, dt * 1.5);
    } else {
      // Homing phase — accelerate toward player chest. Accel ramps so
      // wisps "snap in" rather than glide gently (matches the absorb
      // sound profile we want — punchy, not soft).
      tmp.set(
        playerPos.x - w.sprite.position.x,
        playerPos.y + HOMING_BIAS_Y - w.sprite.position.y,
        playerPos.z - w.sprite.position.z,
      );
      const distSq = tmp.lengthSq();
      if (distSq < ABSORB_RADIUS_SQ) {
        // Absorbed — grant XP, fire event (sound + HUD pulse), remove.
        grantXp(1);
        emit({ type: 'xp:absorbed' });
        w.sprite.parent?.remove(w.sprite);
        (w.sprite.material as THREE.SpriteMaterial).dispose();
        wisps.splice(i, 1);
        continue;
      }
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const homeT = w.age - w.burstDuration;
      const accel = 7 + homeT * 22;
      w.vel.x += tmp.x * inv * accel * dt;
      w.vel.y += tmp.y * inv * accel * dt;
      w.vel.z += tmp.z * inv * accel * dt;
      const speedSq = w.vel.lengthSq();
      if (speedSq > MAX_HOMING_SPEED * MAX_HOMING_SPEED) {
        const s = MAX_HOMING_SPEED / Math.sqrt(speedSq);
        w.vel.multiplyScalar(s);
      }
      w.sprite.position.addScaledVector(w.vel, dt);
    }

    // Scale pulse — slightly larger as the wisp ages so absorption
    // feels weighty (the closer-it-gets-the-bigger-it-is read).
    const s = 0.28 + Math.min(0.45, w.age * 0.35);
    w.sprite.scale.set(s, s, 1);
  }
}

/** Retire every active wisp. Called on level swap. */
export function clearXpWisps(): void {
  for (const w of wisps) {
    w.sprite.parent?.remove(w.sprite);
    (w.sprite.material as THREE.SpriteMaterial).dispose();
  }
  wisps.length = 0;
}
