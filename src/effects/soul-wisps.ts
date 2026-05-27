import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';

// Soul wisps — one-shot additive sprites spawned when a mob dies, drifting
// upward and fading. Pure visual; no game-state side effects.
//
// Allocation strategy: fresh SpriteMaterial + Sprite per wisp, disposed on
// fade. At ~5 wisps × 0.5s active per kill, and bursts coming every few
// seconds at most, the GC churn is below noise. If kills get denser later
// (boss rush?) we can swap to a fixed pool with the same external API.

interface Wisp {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  total: number;
}

const wisps: Wisp[] = [];

export function spawnSoulWisps(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  color: number,
  count: number = 5,
): void {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sp = new THREE.Sprite(mat);
    // Birth jitter around the origin — wisps emerge from across the body,
    // not all from a single point. Slight upward bias so they start near
    // the chest/head region.
    sp.position.set(
      origin.x + (Math.random() - 0.5) * 0.45,
      origin.y + 0.25 + Math.random() * 0.5,
      origin.z + (Math.random() - 0.5) * 0.45,
    );
    sp.scale.setScalar(0.32 + Math.random() * 0.22);
    scene.add(sp);
    wisps.push({
      sprite: sp,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.55,
        1.0 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.55,
      ),
      life: 0,
      total: 0.85 + Math.random() * 0.55,
    });
  }
}

/** Per-frame tick. Integrates motion, fades, retires expired wisps. */
export function tickSoulWisps(dt: number): void {
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    w.life += dt;
    w.sprite.position.addScaledVector(w.vel, dt);
    // Damp horizontal speed so wisps rise more vertically as they age.
    w.vel.x *= Math.pow(0.5, dt * 2);
    w.vel.z *= Math.pow(0.5, dt * 2);
    // Slight upward damp — wisps lose buoyancy as they fade.
    w.vel.y *= Math.pow(0.7, dt * 1.2);
    const t = w.life / w.total;
    const mat = w.sprite.material as THREE.SpriteMaterial;
    // Quick brighten then fade — ease-out curve looks energetic vs linear.
    const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    mat.opacity = Math.max(0, fade * 0.95);
    const s = 0.32 + t * 0.7;
    w.sprite.scale.set(s, s, 1);
    if (t >= 1) {
      w.sprite.parent?.remove(w.sprite);
      mat.dispose();
      wisps.splice(i, 1);
    }
  }
}

/** Retire every active wisp. Called on level swap so old-floor effects
 *  don't poke through the new floor's scene graph. */
export function clearSoulWisps(): void {
  for (const w of wisps) {
    w.sprite.parent?.remove(w.sprite);
    (w.sprite.material as THREE.SpriteMaterial).dispose();
  }
  wisps.length = 0;
}
