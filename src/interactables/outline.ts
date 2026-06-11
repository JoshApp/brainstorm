import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Interactable } from './types';
import { getAllInteractables } from './system';

// Outline highlight — a slightly larger silhouette of an interactable's
// geometry, rendered with an additive emissive material. The classic
// inverted-hull trick:
//
//   - take the object's solid geometry, scaled ~1.07×
//   - render with side: BackSide so only the back faces poke out
//   - depthWrite: false so the silhouette doesn't occlude the original
//
// Cheap (no shaders), reads well on PSX-style geometry.
//
// ONE HULL PER ANIMATED PARENT. The naive version cloned EVERY mesh under the
// interactable — including flat UI-ish bits (a pickup's emissive floor disc +
// in-range ring) that have no business wearing an inverted hull, and one extra
// transparent additive draw PER PART. A 4-part sword pickup near the player was
// 6 outline clones (disc + ring + 4 parts), all overdraw, EVERY frame. Instead
// we now: skip sprites + TRANSPARENT source meshes (glow planes aren't
// silhouette), then merge the remaining solids per PARENT node into a single
// hull. Per-parent (not whole-object) so an animated child — a pickup's bobbing
// item group, a chest lid — still carries its own hull. A pickup drops from 6
// outline draws to 1; a chest/altar from N to ~1.
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
const NEARBY_MAX_OPACITY = 0.32;   // faint cap (additive → only reads in dark)
const ARMED_BASE_OPACITY = 0.78;
const SEALED_BASE_OPACITY = 0.45;

interface OutlineRef {
  clone: THREE.Mesh;
  /** Per-target material so opacity + color can differ by tier/distance. */
  mat: THREE.MeshBasicMaterial;
}

// One entry per interactable currently showing an outline.
const outlines = new Map<Interactable, OutlineRef[]>();
let pulseT = 0;

const tmpColor = new THREE.Color();

// Test/perf escape hatch: `?nooutline=1` (DEV) skips the whole system so a perf
// scenario can isolate the rest of the frame from the outline's overdraw.
let disabled = false;
export function setOutlinesDisabled(on: boolean): void { disabled = on; }

const tmpCenter = new THREE.Vector3();

/** Solid (non-sprite, non-transparent, non-outline) source mesh? Transparent
 *  meshes — a pickup's emissive disc/ring, glow planes — are NOT silhouette
 *  geometry; an inverted hull around them is meaningless overdraw. */
function isSolidSource(mesh: THREE.Mesh): boolean {
  if (!mesh.isMesh || !mesh.geometry) return false;
  if ((mesh as unknown as { isSprite?: boolean }).isSprite) return false;
  if (mesh.userData.outline) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return !mats.some((m) => m && (m as THREE.Material).transparent);
}

/** One inverted-hull outline per ANIMATED PARENT: collect each parent's solid
 *  child meshes, merge their geometry (baked into the parent's local frame),
 *  and emit a single BackSide hull scaled around its own centre. The hull is a
 *  child of that parent, so it rides the parent's animation for free — no
 *  per-frame transform sync. */
function buildOutlinesFor(target: Interactable): OutlineRef[] {
  const root = target.built?.group;
  if (!root) return [];
  const scaleFactor = target.outlineScale ?? OUTLINE_SCALE_DEFAULT;

  // Group solid meshes by their parent node (so animated sub-parts keep a hull
  // that follows them).
  const byParent = new Map<THREE.Object3D, THREE.Mesh[]>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!isSolidSource(mesh) || !mesh.parent) return;
    const arr = byParent.get(mesh.parent);
    if (arr) arr.push(mesh); else byParent.set(mesh.parent, [mesh]);
  });

  const refs: OutlineRef[] = [];
  for (const [parent, meshes] of byParent) {
    // Bake each mesh's local transform into a POSITION-ONLY geometry (position
    // is all the hull needs; stripping the rest lets mixed primitives merge).
    const geos: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      m.updateMatrix();
      const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = src.getAttribute('position');
      if (!pos) { if (src !== m.geometry) src.dispose(); continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pos.clone());
      g.applyMatrix4(m.matrix);
      geos.push(g);
      if (src !== m.geometry) src.dispose();
    }
    if (!geos.length) continue;
    const merged = geos.length === 1 ? geos[0] : (mergeGeometries(geos, false) ?? geos[0]);
    if (merged !== geos[0]) geos[0].dispose();
    for (let i = 1; i < geos.length; i++) if (geos[i] !== merged) geos[i].dispose();

    // NORMAL-PUSH SHELL — not a scale. Uniform scaling around the bbox
    // centre broke long thin weapons: a 1.3m scythe's tips shifted
    // ~4.5cm out (the visible disconnect) while its thin haft gained
    // ~1.5mm of rim, and when the centre fell BETWEEN the haft and
    // blade masses the scale pushed the two apart entirely (the
    // reaper's full split). Instead: weld the soup so coincident
    // vertices share normals, smooth them, and bake every vertex a
    // constant distance outward along its normal — pivot-independent,
    // a uniform rim at the tip and the haft alike, parts inseparable.
    let shell = mergeVertices(merged, 1e-3);
    if (shell !== merged) merged.dispose();
    shell.computeVertexNormals();
    // Honour authored outlineScale intent: map the old scale delta to
    // an equivalent thickness (1.07 → 4.5mm). Calibrated to the SIDE
    // rim, not the tip error: weapon blades are ~8-10mm thick, so a
    // 13mm shell out-fattened the blade itself and read as a casing.
    const thickness = 0.0045 * ((scaleFactor - 1) / 0.07);
    {
      const posA = shell.getAttribute('position') as THREE.BufferAttribute;
      const norA = shell.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < posA.count; i++) {
        posA.setXYZ(
          i,
          posA.getX(i) + norA.getX(i) * thickness,
          posA.getY(i) + norA.getY(i) * thickness,
          posA.getZ(i) + norA.getZ(i) * thickness,
        );
      }
      posA.needsUpdate = true;
    }

    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_ARMED,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const clone = new THREE.Mesh(shell, mat);
    clone.renderOrder = 999;
    clone.userData.outline = true;
    clone.frustumCulled = false;   // its source may be tiny; avoid pop at the edge
    parent.add(clone);
    refs.push({ clone, mat });
  }
  return refs;
}

function removeOutline(target: Interactable) {
  const refs = outlines.get(target);
  if (!refs) return;
  for (const r of refs) {
    r.clone.parent?.remove(r.clone);
    r.clone.geometry.dispose();   // merged geometry is owned by this hull
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
  if (disabled) {
    if (outlines.size) clearAllOutlines();
    return;
  }
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

    // Transform sync is unnecessary now: each hull is a child of its source's
    // parent and baked in that frame, so it rides the parent's animation. Only
    // the tier-driven opacity/color change per frame.
    for (const r of refs) {
      r.mat.opacity = opacity;
      r.mat.color.copy(tmpColor);
    }
  }
}

/** Drop every outline + dispose its materials. Call on level teardown. */
export function clearAllOutlines() {
  for (const target of [...outlines.keys()]) removeOutline(target);
}
