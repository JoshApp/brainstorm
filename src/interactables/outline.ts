import * as THREE from 'three';
import type { Interactable } from './types';
import { getAllInteractables } from './system';

// Outline highlight — a slightly larger silhouette of an interactable's
// geometry, rendered with an additive emissive material. The classic
// inverted-hull trick:
//
//   - clone each mesh's geometry, scaled ~1.07×
//   - render with side: BackSide so only the back faces poke out
//   - depthWrite: false so the silhouette doesn't occlude the original
//
// Cheap (no shaders), reads well on PSX-style geometry.
//
// TWO tiers, same trick:
//   - ARMED   the in-range interactable — bright amber, breathing. The active
//             "press USE" signal (unchanged behaviour).
//   - NEARBY  any interactable within NEARBY_RADIUS — a FAINT amber rim that
//             strengthens as you approach. Because the rim is additive, it's
//             washed out against torchlit surfaces and only reads against
//             darkness — so it guides navigation in the black WITHOUT
//             diluting the "uncommon light = something happening" rule in lit
//             rooms. Doors are interactables, so doorways get this for free.

const OUTLINE_SCALE_DEFAULT = 1.07;
const COLOR_ARMED  = 0xffd6a0;
const COLOR_SEALED = 0x808088;

const NEARBY_RADIUS = 4.0;         // m — interactables within this glow faintly
const NEARBY_MAX_OPACITY = 0.20;   // faint cap (additive → only reads in dark)
const ARMED_BASE_OPACITY = 0.78;
const SEALED_BASE_OPACITY = 0.45;

interface OutlineRef {
  clone: THREE.Mesh;
  src: THREE.Mesh;
  /** Per-target material so opacity + color can differ by tier/distance. */
  mat: THREE.MeshBasicMaterial;
  scaleFactor: number;
}

// One entry per interactable currently showing an outline.
const outlines = new Map<Interactable, OutlineRef[]>();
let pulseT = 0;

const tmpColor = new THREE.Color();

function buildOutlinesFor(target: Interactable): OutlineRef[] {
  const root = target.built?.group;
  if (!root) return [];
  const scaleFactor = target.outlineScale ?? OUTLINE_SCALE_DEFAULT;
  const refs: OutlineRef[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Skip sprites — camera-facing geometry makes the back-side trick halo.
    if ((mesh as unknown as { isSprite?: boolean }).isSprite) return;
    if (!mesh.geometry) return;
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_ARMED,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const clone = new THREE.Mesh(mesh.geometry, mat);
    clone.position.copy(mesh.position);
    clone.rotation.copy(mesh.rotation);
    clone.scale.copy(mesh.scale).multiplyScalar(scaleFactor);
    clone.renderOrder = mesh.renderOrder + 1;
    clone.userData.outline = true;
    mesh.parent?.add(clone);
    refs.push({ clone, src: mesh, mat, scaleFactor });
  });
  return refs;
}

function removeOutline(target: Interactable) {
  const refs = outlines.get(target);
  if (!refs) return;
  for (const r of refs) {
    r.clone.parent?.remove(r.clone);
    r.mat.dispose();
  }
  outlines.delete(target);
}

/** Per-frame call. `inRange` = the armed interactable (or null); nearby
 *  interactables within NEARBY_RADIUS of `playerPos` get the faint tier. */
export function updateOutline(
  inRange: Interactable | null,
  dt: number,
  playerPos: THREE.Vector3,
) {
  pulseT += dt;
  const pulse = 0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2 / 1.1);

  // Desired set: in-range + every interactable within radius that has a model.
  const desired = new Set<Interactable>();
  if (inRange) desired.add(inRange);
  const r2 = NEARBY_RADIUS * NEARBY_RADIUS;
  for (const it of getAllInteractables()) {
    if (!it.built?.group) continue;
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    if (dx * dx + dz * dz <= r2) desired.add(it);
  }

  // Drop outlines that are no longer wanted; build the new ones.
  for (const target of [...outlines.keys()]) {
    if (!desired.has(target)) removeOutline(target);
  }
  for (const target of desired) {
    if (!outlines.has(target)) outlines.set(target, buildOutlinesFor(target));
  }

  // Per-target color + opacity + transform sync.
  for (const [target, refs] of outlines) {
    const sealed = target.promptLabel === 'SEALED';
    const armed = target === inRange;

    let opacity: number;
    if (armed) {
      opacity = (sealed ? SEALED_BASE_OPACITY : ARMED_BASE_OPACITY) + 0.15 * pulse;
    } else {
      const dx = target.position.x - playerPos.x;
      const dz = target.position.z - playerPos.z;
      const fade = Math.max(0, 1 - Math.hypot(dx, dz) / NEARBY_RADIUS); // 1 near → 0 at radius
      opacity = NEARBY_MAX_OPACITY * fade * (0.75 + 0.25 * pulse);
    }
    tmpColor.set(sealed ? COLOR_SEALED : COLOR_ARMED);

    for (const r of refs) {
      r.mat.opacity = opacity;
      r.mat.color.copy(tmpColor);
      r.clone.position.copy(r.src.position);
      r.clone.rotation.copy(r.src.rotation);
      r.clone.scale.copy(r.src.scale).multiplyScalar(r.scaleFactor);
    }
  }
}

/** Drop every outline + dispose its materials. Call on level teardown. */
export function clearAllOutlines() {
  for (const target of [...outlines.keys()]) removeOutline(target);
}
