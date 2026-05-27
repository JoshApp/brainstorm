import * as THREE from 'three';
import type { Interactable } from './types';

// Outline highlight — when an interactable is in range, render a slightly
// larger silhouette of its geometry behind/around it with an amber
// emissive material. The classic "inverted-hull" trick:
//
//   - clone each mesh's geometry, scaled ~1.06×
//   - render with side: BackSide so only the back faces show
//   - depthWrite: false so the silhouette doesn't occlude the original
//
// The back faces poke out beyond the original mesh's edges and read as
// a glowing outline. Cheap (no shaders), reads on PSX-style geometry
// where a full post-process outline would feel too clean.
//
// Single live target at a time (only one thing is in-range). When the
// target changes, the previous outline meshes are removed.

const OUTLINE_SCALE_DEFAULT = 1.07;
const OUTLINE_COLOR_ARMED  = 0xffd6a0;
const OUTLINE_COLOR_SEALED = 0x808088;

const armedMat = new THREE.MeshBasicMaterial({
  color: OUTLINE_COLOR_ARMED,
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.85,
  fog: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const sealedMat = new THREE.MeshBasicMaterial({
  color: OUTLINE_COLOR_SEALED,
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.45,
  fog: false,
  depthWrite: false,
});

interface OutlineRef {
  // The clone mesh added to the scene graph as a sibling of the original.
  clone: THREE.Mesh;
  // The original mesh — clone's transform is synced to it each frame
  // (so chest lids swinging or pickups bobbing carry the outline along).
  src: THREE.Mesh;
}

let liveOutlines: OutlineRef[] = [];
let currentTarget: Interactable | null = null;
let pulseT = 0;

function clearOutlines() {
  for (const o of liveOutlines) {
    o.clone.parent?.remove(o.clone);
  }
  liveOutlines = [];
}

function buildOutlinesFor(target: Interactable) {
  const root = target.built?.group;
  if (!root) return;
  const isSealed = target.promptLabel === 'SEALED';
  const baseMat = isSealed ? sealedMat : armedMat;
  const scaleFactor = target.outlineScale ?? OUTLINE_SCALE_DEFAULT;
  // Traverse the target's mesh subtree. For each renderable mesh, attach
  // a sibling-cloned outline mesh under the same parent (so animations
  // — chest hinge, pickup bob, door swing — naturally carry it).
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Skip sprites; their built-in geometry is camera-facing and the
    // back-side trick produces ugly halos.
    if ((mesh as unknown as { isSprite?: boolean }).isSprite) return;
    if (!mesh.geometry) return;
    const clone = new THREE.Mesh(mesh.geometry, baseMat);
    clone.position.copy(mesh.position);
    clone.rotation.copy(mesh.rotation);
    clone.scale.copy(mesh.scale).multiplyScalar(scaleFactor);
    clone.userData.outlineScale = scaleFactor;
    clone.renderOrder = mesh.renderOrder + 1;
    clone.userData.outline = true;
    mesh.parent?.add(clone);
    liveOutlines.push({ clone, src: mesh });
  });
}

/** Per-frame call. Pass the current in-range interactable or null. */
export function updateOutline(target: Interactable | null, dt: number) {
  // Target changed → rebuild.
  if (target !== currentTarget) {
    clearOutlines();
    currentTarget = target;
    if (target) buildOutlinesFor(target);
    pulseT = 0;
  }
  if (!target) return;
  // Sync transforms each frame so animated parts (chest lid swing,
  // pickup bob+spin, door open arc) keep the outline glued on.
  for (const o of liveOutlines) {
    o.clone.position.copy(o.src.position);
    o.clone.rotation.copy(o.src.rotation);
    o.clone.scale.copy(o.src.scale).multiplyScalar((o.clone.userData.outlineScale as number) ?? OUTLINE_SCALE_DEFAULT);
  }
  // Subtle pulse — vary opacity ±10% so it BREATHES even when the
  // object is still. Gives the eye an anchor.
  pulseT += dt;
  const pulse = 0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2 / 1.1);
  const mat = (target.promptLabel === 'SEALED') ? sealedMat : armedMat;
  mat.opacity = (target.promptLabel === 'SEALED' ? 0.45 : 0.78) + 0.15 * pulse;
}
