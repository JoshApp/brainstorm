import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merge a viewmodel subtree's STATIC bone meshes into one mesh per material.
//
// The first-person hand is ~88 separate bone meshes, and the whole viewmodel is
// drawn TWICE every frame (the depth pre-pass in render-target.ts + the main
// scene pass), so those meshes cost ~176 draws — ~a quarter of the frame, always
// on screen. But the hand is RIGID in play: the finger curl is baked once per
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
      // TEXTURED parts stay loose — the merge strips everything but
      // position+normal, which would break their uv mapping (e.g. the corpse's
      // blood-pool decal). One or two meshes per model; not worth the risk.
      if ((mat as THREE.MeshStandardMaterial).map) { for (const c of o.children) collect(c); return; }
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
  return `${mat.type}|${col}|${emi}|${(m.roughness ?? 0).toFixed(2)}|${(m.metalness ?? 0).toFixed(2)}|${(m.emissiveIntensity ?? 0).toFixed(2)}|${mat.transparent ? 't' : 'o'}`;
}
