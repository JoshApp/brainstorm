import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { grantXp } from '../state/run-state';
import { emit } from '../broadcast/event-bus';
import { registerWarmup } from '../content/warmup-registry';

// XP "essence" — pale cool motes that drift from a dissolving mob's
// body straight into the player. Replaces the earlier bright orb burst
// (too colorful, broke the grimdark tone) with something dimmer + more
// spectral: small additive sprites with a washed cyan-white tint,
// streaming in over the death animation.
//
// Each particle = 1 XP. They home immediately on spawn — no burst,
// no hover — so the visual reads as "the body is becoming essence and
// flowing into me," not "loot launched my way."
//
// The caller (enemy.ts tickDying) spawns essence INCREMENTALLY over
// the dissolve duration, one wisp per XP point. Spawning origin tracks
// the dissolving body's current rig height.

interface Wisp {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
}

const wisps: Wisp[] = [];
const tmp = new THREE.Vector3();

const ABSORB_RADIUS_SQ = 0.55 * 0.55;
const MAX_HOMING_SPEED = 14;
const HOMING_BIAS_Y = -0.4;
// Blend toward a desired-velocity each frame rather than accumulating
// acceleration — guarantees critically-damped convergence, no orbits.
const HOMING_BLEND_RATE = 9;
const LIFE_CAP = 2.5;             // safety: retire even if it can't reach the player

let HALO_MAT: THREE.SpriteMaterial | null = null;

function ensureResources(): void {
  if (!HALO_MAT) {
    HALO_MAT = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      // Pale washed cool tone — sits closer to white than to bright
      // blue/violet. Restraint over candy: this is essence, not loot
      // confetti.
      color: 0xa8c4d8,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
}

/** Spawn N essence motes at origin. They home immediately on the
 *  player position passed to tickXpWisps. Each absorb = 1 XP. */
export function spawnXpWisps(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  count: number,
): void {
  ensureResources();
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(HALO_MAT!);
    sprite.position.copy(origin);
    sprite.position.x += (Math.random() - 0.5) * 0.18;
    sprite.position.y += (Math.random() - 0.5) * 0.12;
    sprite.position.z += (Math.random() - 0.5) * 0.18;
    sprite.scale.setScalar(0.22 + Math.random() * 0.10);
    scene.add(sprite);
    // Tiny outward kick so motes don't all spawn at the exact same
    // point — gives the stream texture instead of a single bright
    // smear at the body.
    const a = Math.random() * Math.PI * 2;
    wisps.push({
      sprite,
      vel: new THREE.Vector3(
        Math.cos(a) * 0.4,
        0.2 + Math.random() * 0.3,
        Math.sin(a) * 0.4,
      ),
      age: 0,
    });
  }
}

/** Per-frame tick. Each mote homes toward the player chest and is
 *  absorbed on contact. */
export function tickXpWisps(dt: number, playerPos: THREE.Vector3): void {
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    w.age += dt;

    tmp.set(
      playerPos.x - w.sprite.position.x,
      playerPos.y + HOMING_BIAS_Y - w.sprite.position.y,
      playerPos.z - w.sprite.position.z,
    );
    const distSq = tmp.lengthSq();
    if (distSq < ABSORB_RADIUS_SQ || w.age > LIFE_CAP) {
      if (w.age <= LIFE_CAP) {
        grantXp(1);
        emit({ type: 'xp:absorbed' });
      }
      w.sprite.parent?.remove(w.sprite);
      wisps.splice(i, 1);
      continue;
    }
    const inv = 1 / Math.sqrt(distSq);
    // Blend velocity toward a desired-velocity that points at the
    // player at MAX_HOMING_SPEED. Removes orbital momentum entirely —
    // motes can't overshoot and circle the player like satellites.
    const desiredX = tmp.x * inv * MAX_HOMING_SPEED;
    const desiredY = tmp.y * inv * MAX_HOMING_SPEED;
    const desiredZ = tmp.z * inv * MAX_HOMING_SPEED;
    const k = 1 - Math.exp(-HOMING_BLEND_RATE * dt);
    w.vel.x += (desiredX - w.vel.x) * k;
    w.vel.y += (desiredY - w.vel.y) * k;
    w.vel.z += (desiredZ - w.vel.z) * k;
    w.sprite.position.addScaledVector(w.vel, dt);

    // Subtle scale pulse — bigger as it nears the player so the absorb
    // reads as snap-in, not a quiet fade.
    const closeT = Math.max(0, 1 - distSq / 9);     // 0 at 3m, 1 at touch
    const s = 0.22 + closeT * 0.20;
    w.sprite.scale.set(s, s, 1);
  }
}

/** Retire every active wisp. Called on level swap. */
export function clearXpWisps(): void {
  for (const w of wisps) w.sprite.parent?.remove(w.sprite);
  wisps.length = 0;
}

// Boot-warmup: essence motes spawn on every kill. Self-register so the sprite
// program is hot at boot. See content/warmup-registry.ts.
const WARMUP_ORIGIN = new THREE.Vector3(0, 0.5, 0);
registerWarmup({
  label: 'xp-wisps',
  spawn: (scene) => spawnXpWisps(scene, WARMUP_ORIGIN, 4),
  clear: clearXpWisps,
});
