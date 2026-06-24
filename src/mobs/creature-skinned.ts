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
  /** DISMEMBER (no fling): collapse a joint's whole subtree (the limb) out of the
   *  skinned mesh so it VANISHES. Used by part-breaks (phase reveals). Returns
   *  true if the joint was found. Permanent (no un-collapse). */
  severBone: (jointName: string) => boolean;
  /** DISMEMBER (fling): like severBone, but FIRST snapshots the limb's current
   *  geometry into a free-standing chunk mesh (same material → dissolves in sync)
   *  positioned at the limb, THEN collapses it in the body. Returns the chunk for
   *  the caller to fling (spawnFlungPart), or null if the joint wasn't found. */
  severBoneChunk: (jointName: string) => THREE.Mesh | null;
  /** CRUMBLE: shatter the whole body into a few chunks (cut at `cutJoints` — the
   *  severable limbs — plus the leftover torso), collapsing each out of the body.
   *  ONE pass over the verts → a handful of chunk meshes for the caller to fling.
   *  Cheap: it only runs at the moment of death, and the chunks self-remove when
   *  they finish dissolving. */
  crumbleToChunks: (cutJoints: readonly string[]) => THREE.Mesh[];
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

  // ── Dismember support: collapse a joint subtree's verts → invisible limb ──
  const nameToBone = new Map<string, number>();
  for (const [name, obj] of creature.joints) { const i = boneIndex.get(obj); if (i !== undefined) nameToBone.set(name, i); }
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const skin = geometry.attributes.skinIndex as THREE.BufferAttribute;

  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: skin.count, materialIndex: 0 }];
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const matOf = (v: number): number => {
    for (const g of groups) if (v >= g.start && v < g.start + g.count) return g.materialIndex ?? 0;
    return 0;
  };

  // The limb = a joint + every descendant joint (severing a shoulder takes the
  // whole arm) → the set of bone indices riding it.
  const limbBones = (jointName: string): Set<number> | null => {
    const jointObj = creature.joints.get(jointName);
    if (!jointObj) return null;
    const limb = new Set<number>();
    jointObj.traverse((o: THREE.Object3D) => { const i = boneIndex.get(o); if (i !== undefined) limb.add(i); });
    return limb;
  };
  const vertsForBones = (limb: Set<number>): number[] => {
    const out: number[] = [];
    for (let v = 0; v < skin.count; v++) if (limb.has(skin.getX(v))) out.push(v);
    return out;
  };
  // Collapse a vertex list onto one shared point → its triangles become zero-area
  // (not rasterized). Collapse-to-first keeps the point near the limb (no streak).
  const collapseVerts = (verts: number[]): void => {
    if (!verts.length) return;
    const cx = pos.getX(verts[0]), cy = pos.getY(verts[0]), cz = pos.getZ(verts[0]);
    for (const v of verts) pos.setXYZ(v, cx, cy, cz);
    pos.needsUpdate = true;
  };
  // Snapshot a vertex list's CURRENT (skinned) world positions into a free chunk
  // mesh centred on its centroid, in the material that covers most of it (so it
  // reads in the right colour + dissolves in sync — same material object).
  const _v = new THREE.Vector3();
  const buildChunk = (verts: number[]): THREE.Mesh | null => {
    if (verts.length < 3) return null;
    const arr = new Float32Array(verts.length * 3);
    const matVotes = new Map<number, number>();
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      _v.fromBufferAttribute(pos, v); mesh.applyBoneTransform(v, _v); _v.applyMatrix4(mesh.matrixWorld);
      arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z;
      sx += _v.x; sy += _v.y; sz += _v.z;
      matVotes.set(matOf(v), (matVotes.get(matOf(v)) ?? 0) + 1);
    }
    const cx = sx / verts.length, cy = sy / verts.length, cz = sz / verts.length;
    for (let i = 0; i < arr.length; i += 3) { arr[i] -= cx; arr[i + 1] -= cy; arr[i + 2] -= cz; }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    cg.computeVertexNormals();
    let bestMat = 0, bestVotes = -1;
    for (const [m, c] of matVotes) if (c > bestVotes) { bestVotes = c; bestMat = m; }
    const chunk = new THREE.Mesh(cg, mats[bestMat] ?? mats[0]);
    chunk.position.set(cx, cy, cz);
    chunk.updateMatrix();             // bake centroid into local matrix so
    chunk.castShadow = false;         // spawnFlungPart's attach() preserves it
    return chunk;
  };

  const severBone = (jointName: string): boolean => {
    const limb = limbBones(jointName);
    if (!limb) return false;
    collapseVerts(vertsForBones(limb));
    return true;
  };
  const severBoneChunk = (jointName: string): THREE.Mesh | null => {
    const limb = limbBones(jointName);
    if (!limb) return null;
    mesh.updateWorldMatrix(true, false); skeleton.update();
    const verts = vertsForBones(limb);
    const chunk = buildChunk(verts);
    collapseVerts(verts);
    return chunk;
  };
  const crumbleToChunks = (cutJoints: readonly string[]): THREE.Mesh[] => {
    mesh.updateWorldMatrix(true, false); skeleton.update();
    // Map each bone → a piece index: a cut limb, or the leftover torso (last).
    const bonePiece = new Map<number, number>();
    cutJoints.forEach((j, pi) => { const limb = limbBones(j); if (limb) for (const b of limb) bonePiece.set(b, pi); });
    const torsoIdx = cutJoints.length;
    // ONE pass: bucket every vertex into its piece.
    const buckets: number[][] = Array.from({ length: torsoIdx + 1 }, () => []);
    for (let v = 0; v < skin.count; v++) buckets[bonePiece.get(skin.getX(v)) ?? torsoIdx].push(v);
    const chunks: THREE.Mesh[] = [];
    for (const b of buckets) { const c = buildChunk(b); if (c) chunks.push(c); collapseVerts(b); }
    return chunks;
  };

  return { mesh, skeleton, bones, severBone, severBoneChunk, crumbleToChunks };
}
