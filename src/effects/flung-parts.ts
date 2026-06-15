import * as THREE from 'three';
import { isPooledGeometry } from '../scene/geometry-pool';

// Flung body parts — when a limb / head is severed, we DETACH the real subtree
// from the dying body and fling it instead of spawning a fake chunk. It reuses
// the actual merged + pooled geometry (nothing new is allocated) and KEEPS the
// enemy's per-instance material, so it dissolves in sync with the corpse (the
// body's death tick still drives that material's uDissolve uniform). It arcs,
// tumbles, bounces off the floor, and is removed once it's faded.
//
// Leak-safety mirrors enemy.ts death cleanup: on despawn we dispose only
// NON-pooled geometry (the per-instance merged meshes); pooled primitives are
// shared across every mob and must never be disposed. Materials are left (they
// dedup by program; same policy as the corpse cleanup).

interface FlungPart {
  obj: THREE.Object3D;
  vx: number; vy: number; vz: number;
  rvx: number; rvy: number; rvz: number;
  age: number;
  life: number;
}

const parts: FlungPart[] = [];
const GRAVITY     = -9.5;
const BOUNCE_DAMP = 0.30;
const GROUND_DRAG = 0.6;
const FLOOR_Y     = 0.06;

function disposeNonPooled(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !isPooledGeometry(mesh.geometry)) {
      mesh.geometry.dispose();
    }
  });
}

/** True once every dissolvable material on the part has fully dissolved (so a
 *  part that's faded with the corpse despawns early instead of flying invisibly). */
function fullyDissolved(obj: THREE.Object3D): boolean {
  let any = false;
  let allGone = true;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    const u = m?.userData?.uDissolve as { value: number } | undefined;
    if (u) { any = true; if (u.value < 0.98) allGone = false; }
  });
  return any && allGone;
}

export interface FlungOpts {
  /** Hard life cap (s). Despawns earlier via fullyDissolved() once the corpse's
   *  shared dissolve completes. Generous so the part is never culled mid-dissolve. */
  life?: number;
  /** Horizontal launch speed range (m/s). Low = pieces drop near the body. */
  hor?: [number, number];
  /** Upward launch speed range (m/s). Low = a collapse (gravity-led), high = a
   *  severed chunk thrown clear. */
  up?: [number, number];
  /** Tumble spin magnitude (rad/s, ± half). */
  spin?: number;
}

const FLING_DEFAULTS: Required<FlungOpts> = {
  life: 2.2,
  hor: [1.8, 3.1],
  up: [2.2, 3.2],
  spin: 15,
};

// A COLLAPSE preset (skeleton crumble): the bone falls mostly straight down
// with a little outward scatter + slower tumble — strings cut, not blown apart.
export const COLLAPSE_PRESET: FlungOpts = {
  life: 4,
  hor: [0.3, 1.0],
  up: [0.4, 1.1],
  spin: 7,
};

/** Detach `obj` (a joint subtree of a dying enemy) into `worldParent` keeping
 *  its world transform, and launch it along (dirX, dirZ). Defaults fling a
 *  severed chunk in a high arc; pass COLLAPSE_PRESET to drop it in a pile. */
export function spawnFlungPart(
  worldParent: THREE.Object3D,
  obj: THREE.Object3D,
  dirX: number, dirZ: number,
  opts: FlungOpts = {},
): void {
  const o = { ...FLING_DEFAULTS, ...opts };
  worldParent.attach(obj);   // reparent, preserving world transform
  const len = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / len, nz = dirZ / len;
  const horSpeed = o.hor[0] + Math.random() * (o.hor[1] - o.hor[0]);
  const upSpeed = o.up[0] + Math.random() * (o.up[1] - o.up[0]);
  parts.push({
    obj,
    vx: nx * horSpeed, vy: upSpeed, vz: nz * horSpeed,
    rvx: (Math.random() - 0.5) * o.spin, rvy: (Math.random() - 0.5) * o.spin, rvz: (Math.random() - 0.5) * o.spin,
    age: 0,
    life: o.life,
  });
}

export function tickFlungParts(dt: number): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy += GRAVITY * dt;
    p.obj.position.x += p.vx * dt;
    p.obj.position.y += p.vy * dt;
    p.obj.position.z += p.vz * dt;
    if (p.obj.position.y < FLOOR_Y && p.vy < 0) {
      p.obj.position.y = FLOOR_Y;
      p.vy *= -BOUNCE_DAMP;
      p.vx *= GROUND_DRAG;
      p.vz *= GROUND_DRAG;
      p.rvx *= 0.6; p.rvy *= 0.6; p.rvz *= 0.6;
    }
    p.obj.rotation.x += p.rvx * dt;
    p.obj.rotation.y += p.rvy * dt;
    p.obj.rotation.z += p.rvz * dt;
    p.age += dt;
    if (p.age >= p.life || fullyDissolved(p.obj)) {
      p.obj.parent?.remove(p.obj);
      disposeNonPooled(p.obj);
      parts.splice(i, 1);
    }
  }
}

export function clearFlungParts(): void {
  for (const p of parts) {
    p.obj.parent?.remove(p.obj);
    disposeNonPooled(p.obj);
  }
  parts.length = 0;
}
