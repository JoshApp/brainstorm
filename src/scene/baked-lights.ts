import * as THREE from 'three';
import { isWebGPU } from './renderer-mode';
import { forEachLight, unregisterLight } from './light-pool';
import type { StyleMaterials } from '../style/materials';
import { attribute, vec3, diffuseColor, uniform as tslUniform } from 'three/tsl';

// BAKED STATIC LIGHTING — prototype (?bakelights=1). Static torches don't move, so
// their diffuse contribution to the static surfaces (walls/floor/ceiling — unique
// merged geometry, 16x12-subdivided so per-vertex is smooth) is computed ONCE at
// floor load and stored in an `aBaked` vertex attribute. The torches are then
// dropped from the live light pool, so the big-pixel-count surfaces stop paying
// per-fragment per-light cost. Only the lamp stays real-time. A global flicker
// scalar keeps the baked light breathing.
//
// PROTOTYPE LIMITS: dynamic objects (mobs) + pooled-geometry props are NOT baked,
// and removing the torches darkens them — the production version needs light
// LAYERS (torches light mobs only; walls use baked). Test on a mob-free floor.

/* eslint-disable @typescript-eslint/no-explicit-any */
const RECIP_PI = 0.3183098861837907;
const BAKE_SCALE = 3.5;            // tune to match the live torch brightness (carries the room the removed fills used to)
const flickerNode = (tslUniform as any)(1.0);
let wired = false;

interface BakedTorch { x: number; y: number; z: number; r: number; g: number; b: number; i: number; range: number; }

export function bakeStaticLights(scene: THREE.Scene, mats: StyleMaterials): void {
  if (!isWebGPU()) return;

  // 1. Snapshot the static environment torches (position, colour, base intensity).
  const torches: BakedTorch[] = [];
  const ids: string[] = [];
  const col = new THREE.Color();
  forEachLight('environment', (src: any) => {
    if (src.getColor) src.getColor(col); else col.setHex(src.color);
    torches.push({ x: src.position.x, y: src.position.y, z: src.position.z, r: col.r, g: col.g, b: col.b, i: src.intensity, range: src.distance || 8 });
    ids.push(src.id);
  });
  if (torches.length === 0) return;

  // 2. Bake per-vertex incident light into wall/floor/ceiling meshes.
  const surfaces = new Set<any>([mats.wall, mats.floor, mats.ceiling]);
  const wp = new THREE.Vector3(), wn = new THREE.Vector3(), L = new THREE.Vector3(), nm = new THREE.Matrix3();
  scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const m = o.material;
    const isSurface = Array.isArray(m) ? m.some((x: any) => surfaces.has(x)) : surfaces.has(m);
    if (!isSurface) return;
    const pos = o.geometry.attributes.position, norm = o.geometry.attributes.normal;
    if (!pos || !norm) return;
    o.updateWorldMatrix(true, false);
    nm.getNormalMatrix(o.matrixWorld);
    const n = pos.count;
    const baked = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      wp.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(o.matrixWorld);
      wn.set(norm.getX(v), norm.getY(v), norm.getZ(v)).applyMatrix3(nm).normalize();
      let br = 0, bg = 0, bb = 0;
      for (const t of torches) {
        L.set(t.x - wp.x, t.y - wp.y, t.z - wp.z);
        const d = L.length();
        if (d >= t.range || d < 1e-3) continue;
        const ndl = Math.max(0, wn.dot(L) / d);
        if (ndl <= 0) continue;
        const dn = d / t.range; let win = Math.max(0, 1 - dn * dn * dn * dn); win *= win;   // ranged falloff
        const e = t.i * win / Math.max(d * d, 0.04) * ndl * RECIP_PI * BAKE_SCALE;
        br += t.r * e; bg += t.g * e; bb += t.b * e;
      }
      baked[v * 3] = br; baked[v * 3 + 1] = bg; baked[v * 3 + 2] = bb;
    }
    o.geometry.setAttribute('aBaked', new THREE.BufferAttribute(baked, 3));
  });

  // 3. Wire the baked light into the surface materials (once): reflected off the
  //    albedo (× diffuseColor) + a global flicker, added as emissive.
  if (!wired) {
    for (const mat of surfaces) {
      const e = mat.emissive ?? new THREE.Color(0), ei = mat.emissiveIntensity ?? 1;
      const baseE: any = (vec3 as any)(e.r * ei, e.g * ei, e.b * ei);
      const aB: any = (attribute as any)('aBaked', 'vec3');
      mat.emissiveNode = baseE.add(aB.mul(flickerNode).mul((diffuseColor as any).rgb));
      mat.needsUpdate = true;
    }
    wired = true;
  }

  // 4. Drop the baked torches from the live pool — walls/floor/ceiling no longer
  //    pay for them per fragment; only the lamp stays real-time.
  for (const id of ids) unregisterLight(id);
}

/** Gentle global flicker so the baked torchlight breathes (prototype approx). */
export function tickBakedFlicker(t: number): void {
  if (!wired) return;
  flickerNode.value = 0.9 + 0.1 * Math.sin(t * 6.0) * Math.cos(t * 2.3);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
