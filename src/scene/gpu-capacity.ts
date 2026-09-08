import * as THREE from 'three';
import { CONFIG } from '../config';
import { DEV } from '../debug/dev';

// ── GPU CAPACITY — one shader per material family, not one per count ────────
//
// three's node renderer sizes a skinned mesh's bone buffer and an
// InstancedMesh's matrix buffer from the OBJECT (`skeleton.bones.length`,
// `instanceMatrix.count`) and writes that number into the WGSL as a fixed
// array length. The shader source is the program cache key, so a 17-bone
// ghoul and a 14-bone rat compile two vertex programs of the same shader, and
// a 16-link chain and a 37-link chain do the same. Measured on a depth-3
// floor: 14 vertex programs behind the one creature material family, five
// behind the chain material — all identical but for that number.
//
// The fix is to never let the count vary: every skeleton is padded to
// CONFIG.GPU_CAPACITY.SKIN_BONES with inert bones, every instanced buffer is
// allocated at CONFIG.GPU_CAPACITY.INSTANCES and drawn at its real `count`.
// The warm dummies (content/spawn-warmups.ts) use the same helpers, so what
// the warm compiles is byte-for-byte what a live spawn asks for.
//
// A rig or a run that exceeds the capacity rounds up to the next multiple and
// pays one extra program — and says so in DEV, because that is a budget
// decision, not an error.

function roundUp(n: number, step: number, what: string): number {
  if (n <= step) return step;
  const cap = Math.ceil(n / step) * step;
  if (DEV) console.warn(`[gpu-capacity] ${what} needs ${n} > capacity ${step}; using ${cap} (one extra shader program)`);
  return cap;
}

/** Bone-array size for a skeleton of `n` real joints. */
export function skinBoneCapacity(n: number): number {
  return roundUp(n, CONFIG.GPU_CAPACITY.SKIN_BONES, 'skeleton');
}

/** Pad a bone list IN PLACE with inert bones (identity transforms, not in the
 *  scene graph) up to the fixed capacity. Existing indices are unchanged, so
 *  skin indices, sever tables and animation lookups keep working. */
export function padBones(bones: THREE.Object3D[]): THREE.Object3D[] {
  const cap = skinBoneCapacity(bones.length);
  while (bones.length < cap) bones.push(new THREE.Bone());
  return bones;
}

/** Instance-buffer capacity for an InstancedMesh that will draw `n` instances. */
export function instanceCapacity(n: number): number {
  return roundUp(n, CONFIG.GPU_CAPACITY.INSTANCES, 'instanced mesh');
}
