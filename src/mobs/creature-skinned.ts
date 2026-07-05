import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Creature } from '../content/creature-types';
import { setRevealAttributes } from '../ecs/build-model';

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
   *  the caller to fling (spawnFlungPart), or null if the joint wasn't found.
   *  With `cacheKey` (the species id), the FIRST kill's chunk geometry becomes a
   *  shared template and every later kill of the species reuses it — no vertex
   *  bake, no new GPU buffers mid-fight (see chunkTemplates). */
  severBoneChunk: (jointName: string, cacheKey?: string) => THREE.Mesh | null;
  /** CRUMBLE: shatter the whole body into a few chunks (cut at `cutJoints` — the
   *  severable limbs — plus the leftover torso), collapsing each out of the body.
   *  ONE pass over the verts → a handful of chunk meshes for the caller to fling.
   *  Cheap: it only runs at the moment of death, and the chunks self-remove when
   *  they finish dissolving. `cacheKey` templates the pieces like severBoneChunk. */
  crumbleToChunks: (cutJoints: readonly string[], cacheKey?: string) => THREE.Mesh[];
}

// ── Chunk template cache — bake each species' debris pieces ONCE ─────────────
// A severed head/arm chunk is rebuilt from scratch on EVERY kill (vertex scan +
// five typed arrays + fresh GPU buffers), all charged mid-fight, which is
// exactly when the phone CPU is busiest. But modulo pose the piece is the same
// geometry every time — so the first kill's bake is stored here (keyed
// species:joint, plus world scale so an up-scaled elite doesn't reuse a
// normal-size bone) and later kills just wrap the shared geometry in a new
// Mesh: zero bake, zero buffer creation, buffers shared across simultaneous
// kills. Pose fidelity: the template carries the ORIGINAL kill's world-baked
// orientation; reuse compensates yaw (bake-yaw vs current) and anchors at the
// joint's live world position — a one-frame orientation approximation that the
// immediate tumble (spin ≥ 7 rad/s) hides completely.
// Geometries live for the session (bounded: species × ~6 joints) and must
// NEVER be disposed — flung-parts already never disposes (see its WEBGPU note).
interface ChunkTemplate {
  geo: THREE.BufferGeometry;
  mats: THREE.Material | THREE.Material[];
  /** centroid − anchor(joint/root) world offset at bake time */
  offset: THREE.Vector3;
  bakeYaw: number;
}
const chunkTemplates = new Map<string, ChunkTemplate>();

/** Yaw of a (yaw-facing) world matrix — mobs rotate in Y (plus a death topple
 *  in X that we deliberately ignore; the tumble hides it). */
function yawOfMatrix(m: THREE.Matrix4): number {
  return Math.atan2(m.elements[8], m.elements[10]);
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
    // Stamp the per-vertex reveal colours (emissive + rim) so this creature shares ONE reveal pipeline
    // with every other creature regardless of colour (see build-model installRevealWebGPU). force=true:
    // EVERY part — even non-reveal materials — gets the aReveal* layout, so the multi-material grouped
    // merge below stays attribute-consistent (mergeGeometries rejects a mismatch).
    setRevealAttributes(g, (mat.userData as { reveal?: Record<string, number[]> }).reveal, true);
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
  mesh.userData.dbgKind = 'enemy';  // so the scene-audit tallies enemy bodies
  root.add(mesh);
  mesh.bind(skeleton);              // bindMatrix defaults to the mesh's matrixWorld (= root)

  // ── Dismember support: collapse a joint subtree's verts → invisible limb ──
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
  // mesh centred on its centroid, preserving ALL of the limb's materials as
  // groups (so a multi-material limb — e.g. a SKULL with emissive eye-lights —
  // renders exactly like the body; a single dominant material made the head read
  // as a wrong/unlit lump).
  //
  // Normals are carried from the REAL bind normals, transformed through the same
  // bone (offset-point method: skin (p+n) and p, subtract). computeVertexNormals
  // would derive them from winding, which mirrored limbs (negative-scale bones)
  // flip → the chunk lit from the inside. UV is copied too so a material that
  // samples it matches the body exactly.
  const nrmAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const _p = new THREE.Vector3(), _pn = new THREE.Vector3(), _n = new THREE.Vector3();
  const buildChunk = (verts: number[]): THREE.Mesh | null => {
    if (verts.length < 3) return null;
    // Bucket verts by their material so the chunk keeps the limb's real material
    // groups (in a stable order), not just the most common one.
    const byMat = new Map<number, number[]>();
    for (const v of verts) { const mi = matOf(v); const a = byMat.get(mi); if (a) a.push(v); else byMat.set(mi, [v]); }
    const posA = new Float32Array(verts.length * 3);
    const nrmA = new Float32Array(verts.length * 3);
    const uvA = uvAttr ? new Float32Array(verts.length * 2) : null;
    // Per-vertex reveal colours — a flung chunk reuses the creature's reveal materials, which read
    // aReveal* per-vertex (build-model). The chunk builds a FRESH geometry, so it must carry them too
    // or the reveal shader errors ("attribute not found") and forces a recompile. Filled per group
    // from each group's material, like the body — see setRevealAttributes / installRevealWebGPU.
    const eA = new Float32Array(verts.length * 3);
    const rA = new Float32Array(verts.length * 4);
    const chunkMats: THREE.Material[] = [];
    const grp: { start: number; count: number; mat: number }[] = [];
    let w = 0, sx = 0, sy = 0, sz = 0;
    for (const [mi, vs] of byMat) {
      const gStart = w;
      const rev = (mats[mi]?.userData as { reveal?: Record<string, number[]> })?.reveal;
      const em = rev?.reveal_emissive ?? [0, 0, 0];
      const rim = rev?.reveal_rim ?? [0, 0, 0, 1];
      for (const v of vs) {
        _p.fromBufferAttribute(pos, v); mesh.applyBoneTransform(v, _p); _p.applyMatrix4(mesh.matrixWorld);
        posA[w * 3] = _p.x; posA[w * 3 + 1] = _p.y; posA[w * 3 + 2] = _p.z;
        sx += _p.x; sy += _p.y; sz += _p.z;
        if (nrmAttr) {
          // world(p+n) - world(p) = the bone-transformed normal (mirror-correct).
          _pn.fromBufferAttribute(pos, v).add(_n.fromBufferAttribute(nrmAttr, v));
          mesh.applyBoneTransform(v, _pn); _pn.applyMatrix4(mesh.matrixWorld).sub(_p).normalize();
          nrmA[w * 3] = _pn.x; nrmA[w * 3 + 1] = _pn.y; nrmA[w * 3 + 2] = _pn.z;
        }
        if (uvA && uvAttr) { uvA[w * 2] = uvAttr.getX(v); uvA[w * 2 + 1] = uvAttr.getY(v); }
        eA[w * 3] = em[0]; eA[w * 3 + 1] = em[1]; eA[w * 3 + 2] = em[2];
        rA[w * 4] = rim[0]; rA[w * 4 + 1] = rim[1]; rA[w * 4 + 2] = rim[2]; rA[w * 4 + 3] = rim[3];
        w++;
      }
      grp.push({ start: gStart, count: vs.length, mat: chunkMats.length });
      chunkMats.push(mats[mi] ?? mats[0]);
    }
    const cx = sx / verts.length, cy = sy / verts.length, cz = sz / verts.length;
    for (let i = 0; i < posA.length; i += 3) { posA[i] -= cx; posA[i + 1] -= cy; posA[i + 2] -= cz; }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(posA, 3));
    if (nrmAttr) cg.setAttribute('normal', new THREE.BufferAttribute(nrmA, 3)); else cg.computeVertexNormals();
    if (uvA) cg.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
    cg.setAttribute('aRevealEmissive', new THREE.BufferAttribute(eA, 3));
    cg.setAttribute('aRevealRim', new THREE.BufferAttribute(rA, 4));
    if (chunkMats.length > 1) for (const g of grp) cg.addGroup(g.start, g.count, g.mat);
    const chunk = new THREE.Mesh(cg, chunkMats.length === 1 ? chunkMats[0] : chunkMats);
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

  // ── Template plumbing (see chunkTemplates above) ──
  const _anchor = new THREE.Vector3();
  /** World position the template is anchored at: the joint (limbs) or the
   *  skinned mesh root (torso leftover). Assumes world matrices are current. */
  const anchorWorld = (jointName: string | null, out: THREE.Vector3): THREE.Vector3 => {
    const j = jointName ? creature.joints.get(jointName) : null;
    return j ? j.getWorldPosition(out) : out.setFromMatrixPosition(mesh.matrixWorld);
  };
  /** Full key: species + joint + world scale (an up-scaled elite must not
   *  reuse a normal-size bone). */
  const templateKey = (cacheKey: string, piece: string): string => {
    const sc = _anchor.setFromMatrixScale(mesh.matrixWorld);
    return `${cacheKey}:${piece}@${sc.x.toFixed(2)}`;
  };
  const storeTemplate = (key: string, chunk: THREE.Mesh, jointName: string | null): void => {
    anchorWorld(jointName, _anchor);
    chunkTemplates.set(key, {
      geo: chunk.geometry,
      mats: chunk.material as THREE.Material | THREE.Material[],
      offset: chunk.position.clone().sub(_anchor),
      bakeYaw: yawOfMatrix(mesh.matrixWorld),
    });
  };
  const meshFromTemplate = (tpl: ChunkTemplate, jointName: string | null): THREE.Mesh => {
    const dy = yawOfMatrix(mesh.matrixWorld) - tpl.bakeYaw;
    const c = Math.cos(dy), s = Math.sin(dy);
    anchorWorld(jointName, _anchor);
    const m = new THREE.Mesh(tpl.geo, tpl.mats);
    m.position.set(
      _anchor.x + tpl.offset.x * c + tpl.offset.z * s,
      _anchor.y + tpl.offset.y,
      _anchor.z - tpl.offset.x * s + tpl.offset.z * c,
    );
    m.rotation.y = dy;
    m.castShadow = false;
    m.updateMatrix();
    return m;
  };

  const severBoneChunk = (jointName: string, cacheKey?: string): THREE.Mesh | null => {
    const limb = limbBones(jointName);
    if (!limb) return null;
    mesh.updateWorldMatrix(true, false); skeleton.update();
    const key = cacheKey ? templateKey(cacheKey, jointName) : null;
    const tpl = key ? chunkTemplates.get(key) : undefined;
    if (tpl) {
      collapseVerts(vertsForBones(limb));   // still hide the limb on the body
      return meshFromTemplate(tpl, jointName);
    }
    const verts = vertsForBones(limb);
    const chunk = buildChunk(verts);
    collapseVerts(verts);
    if (chunk && key) storeTemplate(key, chunk, jointName);
    return chunk;
  };
  const crumbleToChunks = (cutJoints: readonly string[], cacheKey?: string): THREE.Mesh[] => {
    mesh.updateWorldMatrix(true, false); skeleton.update();
    // Map each bone → a piece index: a cut limb, or the leftover torso (last).
    const bonePiece = new Map<number, number>();
    cutJoints.forEach((j, pi) => { const limb = limbBones(j); if (limb) for (const b of limb) bonePiece.set(b, pi); });
    const torsoIdx = cutJoints.length;
    // ONE pass: bucket every vertex into its piece.
    const buckets: number[][] = Array.from({ length: torsoIdx + 1 }, () => []);
    for (let v = 0; v < skin.count; v++) buckets[bonePiece.get(skin.getX(v)) ?? torsoIdx].push(v);
    const chunks: THREE.Mesh[] = [];
    buckets.forEach((b, i) => {
      const jointName = i < cutJoints.length ? cutJoints[i] : null;
      const key = cacheKey ? templateKey(cacheKey, jointName ?? 'torso') : null;
      const tpl = key ? chunkTemplates.get(key) : undefined;
      if (tpl) {
        collapseVerts(b);
        chunks.push(meshFromTemplate(tpl, jointName));
        return;
      }
      const c = buildChunk(b);
      collapseVerts(b);
      if (c) {
        chunks.push(c);
        if (key) storeTemplate(key, c, jointName);
      }
    });
    return chunks;
  };

  return { mesh, skeleton, bones, severBone, severBoneChunk, crumbleToChunks };
}
