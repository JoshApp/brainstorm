import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { attribute as tslAttribute, uniform as tslUniform, vec3 as tslVec3, mix as tslMix } from 'three/tsl';
import { isBakeable, bakeFamilyKey, coloredVariant } from '../scene/static-batch';
import { surfaceDetailNameOf, installNamedSurfaceDetail } from '../style/surface-detail';
import { weaponBakedSurface } from '../style/material-registry';

// Merge a viewmodel subtree's STATIC bone meshes into one mesh per material.
//
// The first-person hand is ~88 separate bone meshes, always on screen and never
// culled — a large, permanent slice of the frame. But the hand is RIGID in
// play: the finger curl is baked once per
// weapon at compose time (adjustFingersForGrip); per frame only the whole group
// bobs/sways. So its bones never move relative to each other and can collapse
// into a handful of merged meshes.
//
// Slots (empties — wrist, palm_anchor, finger joints) are LEFT INTACT, so the
// arm IK still reads the wrist and the weapon stays parented to palm_anchor. The
// `exclude` subtree (the weapon, which has its own identity + effects) is
// skipped. Call AFTER the pose is finalized; re-runs cleanly on weapon swap.
//
// NOT for the arms — those are IK-driven (the elbow bends per frame), so their
// bones DO move relative to each other and must stay separate.
//
// WHAT THIS CANNOT DO, and why that is fine (measured 2026-08-10). Buckets key
// on material SIGNATURE, so a sword's blade/guard/grip/pommel — four colours —
// are four buckets of one and merge into nothing. static-batch.ts solves exactly
// that for the world by baking colour into a vertex attribute so everything in a
// shading family shares one material. Applying the same trick here takes the
// viewmodel's 31 visible meshes to 13 shading families on paper — but most of
// those families are singletons anyway, and several members are the IK arm bones
// that must stay apart regardless. The real yield is ~8-12 meshes, against a
// change that reaches into how the weapon is coloured and flashed. Not worth it
// at this price; revisit only if the viewmodel grows.
export function mergeRigidViewmodel(group: THREE.Object3D, exclude?: THREE.Object3D | null, label = 'hand-merged'): void {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const local = new THREE.Matrix4();

  interface Bucket { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; recv: boolean; order: number }
  // Group by material SIGNATURE, not identity: the hand's bones each carry their
  // own material instance (same look, different object), so keying on the
  // instance would merge almost nothing. One representative material is kept.
  const byMat = new Map<string, Bucket>();

  const collect = (o: THREE.Object3D): void => {
    if (o === exclude) return;   // skip the weapon subtree entirely
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !Array.isArray(m.material)) {
      const mat = m.material as THREE.Material;
      // TEXTURED parts merge only with parts sampling the SAME texture (the
      // texture is in the signature): the merge keeps uv now, so a shared map
      // survives it. This is what folds the scanned bone hand (30 parts on one
      // atlas, content/texture-atlas.ts) into one draw. A part with a texture
      // of its own (the corpse's blood-pool decal) is a bucket of one: untouched.
      // TRANSPARENT parts stay loose too — merging them changes sort order
      // against whatever they overlay (lamp glass over its flame, glow gems).
      if (mat.transparent) { for (const c of o.children) collect(c); return; }
      // Bake the mesh's transform relative to the group root into a geometry clone.
      local.multiplyMatrices(inv, m.matrixWorld);
      let geo = m.geometry.clone().applyMatrix4(local);
      // Normalize attributes so MIXED primitives (box + sphere + cylinder) can
      // merge — mergeGeometries needs an identical attribute set across all
      // inputs, and it fails silently (returns null) otherwise. KEEP uv:
      // stripping it minted a position+normal-only layout that no warm dummy
      // covers, so the first mid-play weapon EQUIP compiled its pipeline live
      // (the named 88-230ms `modeldef:opa:plain` hitches in the 2026-07-05
      // recordings). With uv kept (zero-filled when a part lacks it — these
      // materials are untextured, values don't matter), merged meshes land in
      // the same position+normal+uv layout family the warm already covers.
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      }
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }
      // Normalize INDEXING too — a bucket mixing indexed (primitive) and
      // non-indexed (CSG) geometry also makes mergeGeometries return null,
      // which silently left whole material buckets unmerged (the corpse's
      // cloth limbs, found via the 2026-07-04 phone recordings).
      if (geo.index) { const ni = geo.toNonIndexed(); geo.dispose(); geo = ni; }
      const key = matSig(mat);
      let b = byMat.get(key);
      if (!b) { b = { mat, geos: [], meshes: [], cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder }; byMat.set(key, b); }
      b.geos.push(geo);
      b.meshes.push(m);
    }
    for (const c of o.children) collect(c);
  };
  for (const c of group.children) collect(c);

  for (const b of byMat.values()) {
    if (b.geos.length < 2) { for (const g of b.geos) g.dispose(); continue; }   // nothing to save
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();   // the clones; originals' (pooled) geometry is untouched
    if (!merged) continue;                  // attribute mismatch — leave originals in place
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.renderOrder = b.order;
    mesh.name = label;
    group.add(mesh);
    for (const m of b.meshes) m.removeFromParent();   // detach originals; don't dispose pooled geometry
  }
}

/** Stable signature for grouping visually-identical (but per-instance) materials
 *  so their geometry can share one merged mesh + one material. */
function matSig(mat: THREE.Material): string {
  const m = mat as THREE.MeshStandardMaterial;
  const col = m.color ? m.color.getHexString() : '------';
  const emi = m.emissive ? m.emissive.getHexString() : '------';
  return `${mat.type}|${col}|${emi}|${(m.roughness ?? 0).toFixed(2)}|${(m.metalness ?? 0).toFixed(2)}|${(m.emissiveIntensity ?? 0).toFixed(2)}|${mat.transparent ? 't' : 'o'}|${m.map ? m.map.uuid : '-'}`;
}


// ── WEAPONS: COLOUR RIDES THE VERTICES, SO EVERY PART IS ONE DRAW ───────────
//
// mergeRigidViewmodel buckets on material signature, so a sword's blade, guard,
// grip and pommel — four colours, otherwise the same shading — stayed four
// draws, always on screen, each drawn in the main pass AND the lamp shadow.
// After the bone hand became one draw (2026-11-22) the weapon was the largest
// always-visible item left. The fix is the static world's (scene/static-batch.ts):
// bake each part's colour, emissive, roughness and metalness into vertex
// attributes and give every part of a shading FAMILY (flat/smooth, fog, surface
// detail) one material. Uses static-batch's own isBakeable / coloredVariant, so
// the packing is the world's exactly. Parts that can't bake (a texture, a
// double-sided or transparent part, a part that owns its emissive node) are
// left for mergeRigidViewmodel, as before.
//
// The weapon's material is LIVE in two ways the world's is not, so it carries
// two uniforms instead of a frozen emissive:
//   gleam    the perfect-release window: every part flashes white
//   glowMul  the charged strike: emissive × charge
// The viewmodel drives them through the returned handle (they were writes to
// each part's material.emissive / emissiveIntensity, which a baked material
// would ignore).

/** Drives the merged weapon's live emissive (see viewmodel.ts). */
export interface WeaponGlow {
  setGleam(on: boolean): void;
  setGlowMul(mul: number): void;
}

const GLEAM_RGB = new THREE.Color(0xdfefff);
// One held weapon at a time, so one gleam and one glow for every weapon family
// material (they are pooled per family: style/material-registry.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
const uGleam: any = (tslUniform as any)(0);
const uGlowMul: any = (tslUniform as any)(1);
/* eslint-enable @typescript-eslint/no-explicit-any */
const WEAPON_GLOW: WeaponGlow = {
  setGleam: (on) => { uGleam.value = on ? 1 : 0; },
  setGlowMul: (mul) => { uGlowMul.value = mul; },
};

/** Bake + merge a weapon's parts into one mesh per shading family. Returns the
 *  glow handle, or null when there was nothing worth merging (fewer than two
 *  bakeable parts) — the weapon is then left exactly as it was. */
export function mergeWeaponViewmodel(group: THREE.Object3D, label = 'weapon-merged'): WeaponGlow | null {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const variants = new Map<string, THREE.BufferGeometry>();
  interface Fam { src: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; recv: boolean; order: number }
  const fams = new Map<string, Fam>();
  let parts = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (!isBakeable(mat)) return;
    // coloredVariant caches per (geometry, colour); clone before baking this
    // part's transform in, or two parts sharing a geometry would stack it.
    let geo = coloredVariant(variants, m.geometry, mat).clone();
    geo.applyMatrix4(local.multiplyMatrices(inv, m.matrixWorld));
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv', 'color', 'aRevealEmissive', 'aSurface'].includes(name)) geo.deleteAttribute(name);
    }
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (geo.index) { const ni = geo.toNonIndexed(); geo.dispose(); geo = ni; }
    const key = `${bakeFamilyKey(mat)}|${m.castShadow ? 'c' : ''}${m.receiveShadow ? 'r' : ''}`;
    let f = fams.get(key);
    if (!f) { f = { src: mat, geos: [], meshes: [], cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder }; fams.set(key, f); }
    f.geos.push(geo);
    f.meshes.push(m);
    parts++;
  });
  for (const g of variants.values()) g.dispose();
  if (parts < 2) { for (const f of fams.values()) for (const g of f.geos) g.dispose(); return null; }

  for (const f of fams.values()) {
    const merged = f.geos.length === 1 ? f.geos[0] : mergeGeometries(f.geos, false);
    if (f.geos.length > 1) for (const g of f.geos) g.dispose();
    if (!merged) continue;   // attribute mismatch — leave this family's originals
    const key = bakeFamilyKey(f.src);
    const mat = weaponBakedSurface(key, {
      flatShading: !!f.src.flatShading,
      fog: (f.src as THREE.Material & { fog?: boolean }).fog !== false,
    }, (m) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const mm = m as any;
      mm.emissiveNode = (tslMix as any)(
        (tslAttribute as any)('aRevealEmissive', 'vec3'),
        (tslVec3 as any)(GLEAM_RGB.r, GLEAM_RGB.g, GLEAM_RGB.b),
        uGleam,
      ).mul(uGlowMul);
      const surf: any = (tslAttribute as any)('aSurface', 'vec2');
      mm.roughnessNode = surf.x;
      mm.metalnessNode = surf.y;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      m.userData.weaponBaked = true;   // viewmodel.ts: not a gleam target by emissive
      const detail = surfaceDetailNameOf(f.src);
      if (detail) installNamedSurfaceDetail(m, detail);
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = f.cast;
    mesh.receiveShadow = f.recv;
    mesh.renderOrder = f.order;
    mesh.name = label;
    group.add(mesh);
    for (const m of f.meshes) m.removeFromParent();   // pooled geometry is never disposed here
  }
  return WEAPON_GLOW;
}
