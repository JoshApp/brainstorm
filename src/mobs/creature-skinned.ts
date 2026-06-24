import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Creature } from '../content/creature-types';

// ── Creature Render V2 — rigid-skinned creature (M1) ─────────────────────────
//
// Build ONE THREE.SkinnedMesh from a Creature's per-joint meshes, using NATIVE
// rigid skinning: each vertex is bound 100% to its joint's bone (skinWeight
// [1,0,0,0]), so the chunky PS1 look is IDENTICAL — no smooth deform — but the
// whole creature collapses from ~per-joint draws to (number-of-materials) draws.
//
// The existing joint hierarchy (`creature.joints`) IS the skeleton: the bones
// are the joints, and the live per-frame joint animation drives them, so the
// GPU deforms the mesh for free. The geometry is baked into the creature's
// ROOT (bind-pose) space; `bind()` captures each bone's bind-world for the
// inverse-bind matrices.
//
// Same-material parts across DIFFERENT joints share one material group (one
// draw), each vertex carrying its own bone via skinIndex — so a creature with
// N unique materials = N draws, regardless of joint count. See
// docs/CREATURE-RENDER-V2.md.

export interface SkinnedCreature {
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  /** Bones (= the creature joints) the live animation already drives. */
  bones: THREE.Object3D[];
}

/** Normalize a geometry to a consistent attribute set so cross-material merges
 *  never reject a mismatch (creatures freely mix primitives — some carry uv,
 *  some don't). Non-indexed + position/normal/uv/skin. Mutates+returns a clone. */
function normalizeForSkin(src: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  let g = src.clone();
  if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  // Rigid skin: every vertex 100% to its one bone.
  const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) { si[v * 4] = bone; sw[v * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // Drop anything else (color/tangent vary per part and would break the merge);
  // the PS1 materials don't read them.
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
  }
  return g;
}

export function buildSkinnedCreature(creature: Creature): SkinnedCreature {
  const root = creature.group;
  root.updateWorldMatrix(true, true);   // bind pose — bake + boneInverses read this

  const bones = [...creature.joints.values()];
  const boneIndex = new Map<THREE.Object3D, number>();
  bones.forEach((b, i) => boneIndex.set(b, i));
  const jointOf = (o: THREE.Object3D): number => {
    let n: THREE.Object3D | null = o.parent;
    while (n) { const i = boneIndex.get(n); if (i !== undefined) return i; n = n.parent; }
    return 0;   // ride the root bone if no joint ancestor (shouldn't happen)
  };

  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh & { isSprite?: boolean };
    if (m.isMesh && m.isSprite !== true && m.geometry) meshes.push(m);
  });

  // One geometry per unique material, each carrying multi-bone skin attributes.
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const m of meshes) {
    const g = normalizeForSkin(m.geometry, jointOf(m));
    // Bake the mesh's world transform (joint chain) into ROOT/bind space.
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const arr = byMat.get(mat);
    if (arr) arr.push(g); else byMat.set(mat, [g]);
  }

  const materials: THREE.Material[] = [];
  const perMat: THREE.BufferGeometry[] = [];
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const gg of geos) gg.dispose();
    if (!merged) continue;   // skip a material whose parts wouldn't merge
    perMat.push(merged);
    materials.push(mat);
  }
  // Merge the per-material geometries WITH groups → one geometry, material array,
  // one draw per group/material.
  const geometry = perMat.length === 1 ? perMat[0] : mergeGeometries(perMat, true);
  if (perMat.length > 1) for (const gg of perMat) gg.dispose();
  if (!geometry) throw new Error('buildSkinnedCreature: geometry merge failed');

  // Bones must be live in the graph for the renderer to read matrixWorld each
  // frame. The joints already hang under `root`; the skin meshes baked into the
  // SkinnedMesh are removed so we keep ONLY the bones + the one skinned mesh.
  for (const m of meshes) m.parent?.remove(m);

  const skeleton = new THREE.Skeleton(bones as unknown as THREE.Bone[]);
  const mesh = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.castShadow = false;          // creatures use a blob shadow (as today)
  mesh.frustumCulled = false;       // matrix-driven bounds; never cull the whole mob
  root.add(mesh);
  mesh.bind(skeleton);              // bindMatrix defaults to the mesh's matrixWorld (= root)

  return { mesh, skeleton, bones };
}
