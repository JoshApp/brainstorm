import * as THREE from 'three';
import { acquireClone, releaseClone } from '../scene/effect-clone-pool';

// THE AIM LINE — a ranged attack's windup, made visible.
//
// A melee windup is legible for free: something big rears back within arm's
// reach of you, in your light. A projectile windup was not. A spitter at seven
// metres, in the dark, is a small dark shape whose only tell was its core
// pulsing a little brighter — and the first thing you learn from that is that
// ranged enemies hit you at random, which is the wrong lesson and the one this
// game most needs to avoid teaching. You can't respect a pattern you can't see.
//
// So every ranged windup now draws the SHOT IT IS ABOUT TO TAKE: a thin line
// from the shooter to the point it committed to, thickening and brightening as
// the windup completes. The commitment already existed in the AI — the target
// is snapshotted the instant the windup begins and the shot resolves against
// that snapshot — so the line is not a hint, it's the truth, and stepping off it
// works exactly as it appears to.
//
// Same shape as the AoE telegraph (setProgress / dispose), so the enemy state
// machine drives both through one code path.

export interface AimTelegraph {
  /** t: 0..1 over the windup. */
  setProgress(t: number): void;
  dispose(): void;
}

/** Held just off the floor at chest height so it reads as a SHOT and not as a
 *  ground marker (which means something else — see the AoE telegraph). */
const LINE_WIDTH_START = 0.014;
const LINE_WIDTH_END = 0.055;

// Shared template — cloned per instance through the effect pool so opacity
// animates independently, and RECYCLED rather than disposed (on WebGPU a
// disposed last clone drops the pipeline and the next shot recompiles mid-fight;
// see scene/effect-clone-pool.ts).
let _template: THREE.MeshBasicMaterial | null = null;
function template(): THREE.MeshBasicMaterial {
  _template ??= new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  return _template;
}

let _geo: THREE.PlaneGeometry | null = null;
function unitQuad(): THREE.PlaneGeometry {
  // A 1×1 quad with its origin at one END, so scaling Y stretches it from the
  // shooter toward the target instead of growing in both directions.
  _geo ??= new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  return _geo;
}

/**
 * Draw the line a ranged attacker is about to fire along.
 *
 * `from` / `to` are world points, captured at windup start; the line is static
 * once spawned (the attack committed, so the tell must not track a dodging
 * player — that would make it undodgeable and unreadable at once).
 */
export function spawnAimTelegraph(
  scene: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: number,
): AimTelegraph {
  const mat = acquireClone(template());
  // A recycled clone carries the last user's state — reset everything animated.
  mat.color.setHex(color);
  mat.opacity = 0;

  const mesh = new THREE.Mesh(unitQuad(), mat);
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  mesh.position.copy(from);
  // Point the quad's +Y (its length axis, thanks to the origin translate) down
  // the shot. Authoring the aim rather than guessing Euler signs — CLAUDE.md.
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  mesh.scale.set(LINE_WIDTH_START, len, 1);
  mesh.renderOrder = 5;
  scene.add(mesh);

  let disposed = false;
  return {
    setProgress(t: number) {
      if (disposed) return;
      const k = Math.max(0, Math.min(1, t));
      // Ease IN — barely there while there's still time to react, unmistakable
      // in the last third. The window to move is the whole windup; the urgency
      // curve is what makes it read as a countdown rather than a laser sight.
      const e = k * k;
      mat.opacity = 0.10 + e * 0.55;
      mesh.scale.x = LINE_WIDTH_START + (LINE_WIDTH_END - LINE_WIDTH_START) * e;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      mat.opacity = 0;
      releaseClone(template(), mat);
    },
  };
}
