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

// Screen-constant outline material: the shell is pushed along its
// (smoothed) normals IN THE VERTEX SHADER, scaled by view depth so the
// rim holds a near-constant ~1.5px on screen. A constant WORLD
// thickness can't be an outline: on a blade's thin side (8-10mm) any
// world rim wide enough to read becomes a block as wide as the blade;
// on a chest it's a hairline. Pixel-space is the only honest unit for
// a line.
const RIM_PX = 3.2;             // target rim width, device pixels (doubled from 1.6 on phone feel)
function makeOutlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(COLOR_ARMED) },
      uOpacity: { value: 0 },
      uPxScale: { value: 0.002 },   // world-units-per-pixel at z=1; set per frame
    },
    vertexShader: `
      uniform float uPxScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // World push per pixel grows linearly with view depth — the
        // projected rim width stays constant on screen.
        float push = uPxScale * -mv.z;
        vec3 displaced = position + normal * push;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }
    `,
    side: THREE.BackSide,
    transparent: true,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Per-frame px→world scale at unit depth: worldPerPx(z) = z * 2·tan(fov/2)/H. */
export function updateOutlinePxScale(camera: THREE.PerspectiveCamera, viewportH: number): void {
  const worldPerPxAtUnitZ = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportH;
  pxScaleShared.value = worldPerPxAtUnitZ * RIM_PX;
}
const pxScaleShared = { value: 0.002 };
const COLOR_ARMED  = 0xffd6a0;
const COLOR_SEALED = 0x808088;

const NEARBY_RADIUS = 4.0;         // m — interactables within this glow faintly
const NEARBY_MAX_OPACITY = 0.32;   // faint cap (additive → only reads in dark)
const ARMED_BASE_OPACITY = 0.78;
const SEALED_BASE_OPACITY = 0.45;

interface OutlineRef {
  clone: THREE.Mesh;
  /** Per-target material so opacity + color can differ by tier/distance. */
  mat: THREE.ShaderMaterial;
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

    // Weld so coincident vertices share one smoothed normal (the push
    // direction); the push itself happens in the VERTEX SHADER, scaled
    // by view depth for a screen-constant rim (see makeOutlineMaterial).
    // Pivot-independent: tips stay attached, parts can't separate.
    let shell = mergeVertices(merged, 1e-3);
    if (shell !== merged) merged.dispose();
    shell.computeVertexNormals();

    const mat = makeOutlineMaterial();
    // Authored outlineScale maps to a rim-width multiplier.
    mat.uniforms.uPxScale = { value: 0 };   // replaced by the shared ref below
    (mat.uniforms as Record<string, { value: unknown }>).uPxScale = pxScaleShared;
    void scaleFactor;
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
      r.mat.uniforms.uOpacity.value = opacity;
      (r.mat.uniforms.uColor.value as THREE.Color).copy(tmpColor);
    }
  }
}

/** Drop every outline + dispose its materials. Call on level teardown. */
export function clearAllOutlines() {
  for (const target of [...outlines.keys()]) removeOutline(target);
}
