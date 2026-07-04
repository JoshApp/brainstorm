import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial, Node as TSLNode, NodeUpdateType } from 'three/webgpu';
import { uniform as tslUniform, positionLocal, normalLocal, modelViewMatrix, vec4, nodeObject } from 'three/tsl';
import type { Interactable } from './types';
import { getAllInteractables } from './system';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
const RIM_PX = 4.5;             // target rim width, device pixels (phone-tuned)

// PER-OBJECT uniform node (the objectScalar pattern from build-model): reads
// `frame.object.userData[key]` once per object-draw, so ONE shared material shows
// each hull's own colour/opacity — no per-hull material, so no per-instance
// NodeBuffer → one pipeline for every outline instead of a fresh compile per hull
// (the unlit-material churn the compile guard flagged). kind 'color' → vec3 from a
// THREE.Color in userData; 'float' → a number.
class OutlineObjUniform extends (TSLNode as any) {
  key: string; uni: any; kind: 'color' | 'float';
  constructor(key: string, kind: 'color' | 'float') {
    super(kind === 'color' ? 'vec3' : 'float');
    this.key = key; this.kind = kind;
    this.uni = kind === 'color' ? (tslUniform as any)(new THREE.Color(1, 1, 1)) : (tslUniform as any)(0);
    this.updateType = (NodeUpdateType as any).OBJECT;
  }
  update(frame: any): void {
    const v = frame.object?.userData?.[this.key];
    if (this.kind === 'color') { if (v) this.uni.value.copy(v); }
    else this.uni.value = typeof v === 'number' ? v : 0;
  }
  setup(): any { return this.uni; }
}
const objColor = (key: string): any => (nodeObject as any)(new OutlineObjUniform(key, 'color'));
const objFloat = (key: string): any => (nodeObject as any)(new OutlineObjUniform(key, 'float'));

// ONE shared inverted-hull rim material (TSL node): same screen-constant push
// (position += normal · pxScale · −viewZ) + additive colour·opacity, but colour +
// opacity ride PER-OBJECT userData (`_olColor` / `_olOpacity`) so every hull shares
// this single instance → one compiled pipeline. Built lazily once.
let sharedOutlineMat: THREE.Material | null = null;
function makeOutlineMaterial(): THREE.Material {
  if (sharedOutlineMat) return sharedOutlineMat;
  const mat: any = new (MeshBasicNodeMaterial as any)({
    side: THREE.BackSide, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mv = (modelViewMatrix as any).mul((vec4 as any)(positionLocal, 1.0));
  const push = (pxScaleWG as any).mul(mv.z.negate());   // pxScale · −mvz → screen-constant width
  mat.positionNode = (positionLocal as any).add((normalLocal as any).mul(push));
  mat.colorNode = objColor('_olColor');
  mat.opacityNode = objFloat('_olOpacity');
  sharedOutlineMat = mat;
  return mat;
}

/** Per-frame px→world scale at unit depth: worldPerPx(z) = z * 2·tan(fov/2)/H. */
export function updateOutlinePxScale(camera: THREE.PerspectiveCamera, viewportH: number): void {
  const worldPerPxAtUnitZ = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportH;
  const v = worldPerPxAtUnitZ * RIM_PX;
  pxScaleShared.value = v;
  (pxScaleWG as any).value = v;
}
const pxScaleShared = { value: 0.002 };          // WebGL ShaderMaterial uniform (shared across hulls)
const pxScaleWG = (tslUniform as any)(0.002);    // WebGPU TSL uniform (shared); driven by updateOutlinePxScale
const COLOR_ARMED  = 0xffd6a0;
const COLOR_SEALED = 0x808088;

const NEARBY_RADIUS = 4.0;         // m — interactables within this glow faintly
const NEARBY_MAX_OPACITY = 0.32;   // faint cap (additive → only reads in dark)
const ARMED_BASE_OPACITY = 0.78;
const SEALED_BASE_OPACITY = 0.45;

interface OutlineRef {
  clone: THREE.Mesh;
  /** Per-hull colour, mutated in place each frame; the shared material's per-object
   *  colour node reads it from clone.userData._olColor at this hull's draw. */
  col: THREE.Color;
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

    // Shared material; per-hull colour/opacity ride userData (read per object-draw
    // by the material's object-uniform nodes). pxScale is a shared uniform in the
    // positionNode, so no per-material wiring is needed.
    void scaleFactor;
    const clone = new THREE.Mesh(shell, makeOutlineMaterial());
    clone.renderOrder = 999;
    clone.userData.outline = true;
    const col = new THREE.Color(COLOR_ARMED);
    clone.userData._olColor = col;      // read by objColor('_olColor')
    clone.userData._olOpacity = 0;      // read by objFloat('_olOpacity')
    clone.frustumCulled = false;   // its source may be tiny; avoid pop at the edge
    parent.add(clone);
    refs.push({ clone, col });
  }
  return refs;
}

function removeOutline(target: Interactable) {
  const refs = outlines.get(target);
  if (!refs) return;
  for (const r of refs) {
    r.clone.parent?.remove(r.clone);
    r.clone.geometry.dispose();   // merged geometry is owned by this hull
    // NB: the material is SHARED (sharedOutlineMat) — never dispose it here.
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
  // (WebGPU now ported: makeOutlineMaterialWebGPU builds the inverted-hull rim as a TSL node material,
  // so the outline runs on both backends. The old GLSL-ShaderMaterial-threw-every-frame spike is gone.)
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
      r.clone.userData._olOpacity = opacity;
      r.col.copy(tmpColor);   // userData._olColor === r.col; read per object-draw
    }
  }
}

/** Drop every outline + dispose its materials. Call on level teardown. */
export function clearAllOutlines() {
  for (const target of [...outlines.keys()]) removeOutline(target);
}

// Self-registered warmup — compile the outline pipeline behind the load screen so the FIRST interactable
// you near doesn't pay the compile. The warm hull must match the LIVE hull's geometry cache key
// exactly (attribute set + indexedness are both part of the render object's key): buildOutlinesFor
// emits mergeVertices output = INDEXED position+normal, NO uv. A stock BoxGeometry carries uv, which
// warmed a variant no live hull ever uses — the first loot-drop outline then paid its node build +
// pipeline compile in-play (the death-beat `MeshBasicNodeMaterial` compile in the 2026-07-04 traces).
// The warm mesh is retained for the session, so its render object PINS the live variant even when
// every real hull has been removed (removeOutline disposes hull geometry per-interactable).
import { registerWarmup } from '../content/warmup-registry';
let warmOutlineMesh: THREE.Mesh | null = null;
registerWarmup({
  label: 'interactable-outline',
  live: true,
  spawn: (scene: THREE.Object3D) => {
    const hullGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    hullGeo.deleteAttribute('uv');   // live hulls are position+normal only
    const mesh = new THREE.Mesh(hullGeo, makeOutlineMaterial());
    mesh.userData.outline = true;
    mesh.userData._olColor = new THREE.Color(COLOR_ARMED);   // per-object uniforms → visible warm draw
    mesh.userData._olOpacity = 1;
    mesh.frustumCulled = false;
    scene.add(mesh);
    warmOutlineMesh = mesh;
  },
  clear: () => {
    if (!warmOutlineMesh) return;
    warmOutlineMesh.parent?.remove(warmOutlineMesh);
    warmOutlineMesh.geometry.dispose();
    warmOutlineMesh = null;
  },
});
