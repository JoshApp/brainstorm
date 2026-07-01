import * as THREE from 'three';
import { isPooledGeometry } from '../scene/geometry-pool';
import { spawnDustPuff } from './dust-puff';
import { getDeathSink } from '../debug/death-debug';
import { groundYAt } from '../level/elevation';

const _dustPos = new THREE.Vector3();   // scratch for the crumble dust poof

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
  dust: boolean;     // emit a dust poof as it crumbles (bone, not wet flesh)
  dusted: boolean;   // once-guard for that poof
}

const parts: FlungPart[] = [];
const GRAVITY     = -9.5;
const BOUNCE_DAMP = 0.30;
const GROUND_DRAG = 0.6;
// Rest height ABOVE the local ground (not an absolute world Y) — the floor is
// elevation-aware (groundYAt) so a piece flung on a raised/sunken floor settles
// on THAT floor, not punching through to the base level.
const FLOOR_REST  = 0.06;
// Once a piece is well into powdering, the dungeon PULLS IT UNDER — it settles
// through the floor (mirrors the corpse's melt-into-floor). Gentle, and LAGGING
// the dissolve (sink ∝ d², so the shader visibly eats the bone first and the
// sink only finishes it off — otherwise the pull-under outran the dissolve and
// hid it under the floor).
const SINK_RATE   = 0.4;

function disposeNonPooled(obj: THREE.Object3D): void {
  // WEBGPU: never free geometry synchronously — the fire-and-forget renderAsync means
  // a frame is usually in flight, and freeing a buffer it still references invalidates
  // that frame's draws (collapses the species, same as the vase/death-dispose bug). GC
  // reclaims the part's geometry once it leaves the scene. (Flung parts also REUSE the
  // corpse's merged/pooled geometry, so disposing here is doubly unsafe.)
  void obj;
}

/** Max dissolve progress (0..1) across the part's dissolvable materials, or 0 if
 *  it has none. Drives both the despawn check and the pulled-into-the-floor sink. */
function partDissolve(obj: THREE.Object3D): number {
  let d = 0;
  obj.traverse((o) => {
    const u = ((o as THREE.Mesh).material as THREE.Material | undefined)
      ?.userData?.uDissolve as { value: number } | undefined;
    if (u && u.value > d) d = u.value;
  });
  return d;
}

export interface FlungOpts {
  /** Hard life cap (s). Despawns earlier once the part fully dissolves. Generous
   *  so the part is never culled mid-dissolve. */
  life?: number;
  /** Horizontal launch speed range (m/s). Low = pieces drop near the body. */
  hor?: [number, number];
  /** Upward launch speed range (m/s). Low = a collapse (gravity-led), high = a
   *  severed chunk thrown clear. */
  up?: [number, number];
  /** Tumble spin magnitude (rad/s, ± half). */
  spin?: number;
  /** Emit a grey dust poof as the piece crumbles — bone/stone, not wet flesh. */
  dust?: boolean;
}

const FLING_DEFAULTS: Required<FlungOpts> = {
  life: 2.2,
  hor: [1.8, 3.1],
  up: [2.2, 3.2],
  spin: 15,
  dust: false,
};

// A COLLAPSE preset (skeleton crumble): the bone falls mostly straight down
// with a little outward scatter + slower tumble — strings cut, not blown apart —
// and poofs to dust as it powders so the crumble READS, not just the shader.
export const COLLAPSE_PRESET: FlungOpts = {
  life: 4,
  hor: [0.3, 1.0],
  up: [0.4, 1.1],
  spin: 7,
  dust: true,
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
    dust: o.dust,
    dusted: false,
  });
}

export function tickFlungParts(dt: number): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const d = partDissolve(p.obj);
    // Drift horizontally always.
    p.obj.position.x += p.vx * dt;
    p.obj.position.z += p.vz * dt;
    const sinking = d >= 0.02 && getDeathSink();
    if (sinking) {
      // POWDERING + sink ON — the dungeon draws the husk under, gently and
      // CONTROLLED (no gravity here, so it can't plummet through the floor). ∝ d²
      // so the shader visibly eats the bone before the pull-under finishes it.
      p.obj.position.y -= d * d * SINK_RATE * dt;
      p.rvx *= 0.92; p.rvy *= 0.92; p.rvz *= 0.92;
    } else {
      // BALLISTIC — falls under gravity and rests on the floor. Covers both the
      // solid arc AND the dissolving-with-sink-OFF case (DEV), where it just lies
      // there dissolving in place instead of being pulled under.
      p.vy += GRAVITY * dt;
      p.obj.position.y += p.vy * dt;
      const floorY = groundYAt(p.obj.position.x, p.obj.position.z) + FLOOR_REST;
      if (p.obj.position.y < floorY && p.vy < 0) {
        p.obj.position.y = floorY;
        p.vy *= -BOUNCE_DAMP;
        p.vx *= GROUND_DRAG;
        p.vz *= GROUND_DRAG;
        p.rvx *= 0.6; p.rvy *= 0.6; p.rvz *= 0.6;
      }
    }
    // Literal dust as the bone crumbles — fires once when it starts powdering,
    // regardless of the sink toggle. The shader dissolve alone is too subtle on
    // a small piece in the dark; one grey poof makes the powder read.
    if (p.dust && !p.dusted && d >= 0.02) {
      p.dusted = true;
      p.obj.getWorldPosition(_dustPos);
      spawnDustPuff(p.obj.parent ?? p.obj, _dustPos.x, _dustPos.y, _dustPos.z, {
        count: 6, size: 0.16, spread: 0.12, rise: 0.4, life: 0.7,
      });
    }
    p.obj.rotation.x += p.rvx * dt;
    p.obj.rotation.y += p.rvy * dt;
    p.obj.rotation.z += p.rvz * dt;
    p.age += dt;
    if (p.age >= p.life || d >= 0.98) {
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
