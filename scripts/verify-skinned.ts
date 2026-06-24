// Headless M1 verification: build a creature, skin it, and prove the bind is
// correct (skinned bind-pose bbox == original) + report the draw-call win.
//   npx tsx scripts/verify-skinned.ts [enemyId]
import * as THREE from 'three';
import { ENEMIES } from '../src/content/enemies';
import { buildCreature } from '../src/content/build-creature';
import { buildSkinnedCreature } from '../src/mobs/creature-skinned';

const id = process.argv[2] || 'skeleton';
const spec = (ENEMIES as Record<string, { creature: Parameters<typeof buildCreature>[0] }>)[id];
if (!spec) { console.error(`no enemy '${id}'. have: ${Object.keys(ENEMIES).join(', ')}`); process.exit(1); }

const creature = buildCreature(spec.creature);
creature.group.updateWorldMatrix(true, true);
// MESH-ONLY box (the skinned mesh excludes sprites — they stay separate
// billboards — so the box must too, or sprite-eyed mobs read as false mismatches).
const origBox = new THREE.Box3();
let origMeshes = 0;
const wv = new THREE.Vector3();
creature.group.traverse((o) => {
  const m = o as THREE.Mesh & { isSprite?: boolean };
  if (!m.isMesh || m.isSprite === true || !m.geometry) return;
  origMeshes++;
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { wv.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); origBox.expandByPoint(wv); }
});

const sk = buildSkinnedCreature(creature);
sk.mesh.updateWorldMatrix(true, true);
sk.skeleton.update();

const draws = Array.isArray(sk.mesh.material) ? sk.mesh.material.length : 1;
const pos = sk.mesh.geometry.attributes.position;

// Apply skinning to every vertex in BIND pose → world box. Must equal origBox.
const skBox = new THREE.Box3();
const v = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i);
  sk.mesh.applyBoneTransform(i, v);     // → mesh-local skinned
  v.applyMatrix4(sk.mesh.matrixWorld);  // → world
  skBox.expandByPoint(v);
}

// DEBUG: how much does skinning move each vertex from its baked position? (In
// bind pose it should be ZERO.) Find the worst offenders + their bones.
if (process.env.DEBUG) {
  const si = sk.mesh.geometry.attributes.skinIndex;
  let moved = 0; const samples: string[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    a.fromBufferAttribute(pos, i);            // baked
    b.copy(a); sk.mesh.applyBoneTransform(i, b);   // skinned
    const d = a.distanceTo(b);
    if (d > 1e-3) { moved++; if (samples.length < 6) samples.push(`bone${si.getX(i)} Δ${d.toFixed(3)} baked[${a.toArray().map(n=>n.toFixed(2))}]→skin[${b.toArray().map(n=>n.toFixed(2))}]`); }
  }
  console.log(`  DEBUG: ${moved}/${pos.count} verts move under bind-pose skinning (should be 0)`);
  samples.forEach((s) => console.log('    ' + s));
}
// SEVER test: collapse a limb and confirm those verts coincide (limb vanishes).
if (process.env.SEVER) {
  const joint = process.env.SEVER;
  const posA = sk.mesh.geometry.attributes.position as THREE.BufferAttribute;
  const before = new Set<string>();
  for (let i = 0; i < posA.count; i++) before.add(`${posA.getX(i).toFixed(3)},${posA.getY(i).toFixed(3)},${posA.getZ(i).toFixed(3)}`);
  const found = sk.severBone(joint);
  const after = new Set<string>();
  for (let i = 0; i < posA.count; i++) after.add(`${posA.getX(i).toFixed(3)},${posA.getY(i).toFixed(3)},${posA.getZ(i).toFixed(3)}`);
  console.log(`\nSEVER ${id}.${joint}: found=${found}  uniquePositions ${before.size} → ${after.size} (collapse → fewer)  severable=${JSON.stringify((spec as { severable?: string[] }).severable)}`);
}
// CHUNK/CRUMBLE test: severing yields a free chunk; crumble shatters into pieces.
if (process.env.CHUNK) {
  const chunk = sk.severBoneChunk(process.env.CHUNK);
  console.log(`\nCHUNK ${id}.${process.env.CHUNK}: ${chunk ? `mesh verts=${chunk.geometry.attributes.position.count} at [${chunk.position.toArray().map(n=>n.toFixed(2))}]` : 'null'}`);
}
if (process.env.CRUMBLE) {
  const cuts = (spec as { severable?: string[] }).severable ?? ['head', 'shoulderL', 'shoulderR', 'hipL', 'hipR'];
  const chunks = sk.crumbleToChunks(cuts);
  console.log(`\nCRUMBLE ${id}: cuts=${JSON.stringify(cuts)} → ${chunks.length} chunks, verts=[${chunks.map(c=>c.geometry.attributes.position.count).join(',')}]`);
}
const ok = origBox.min.distanceTo(skBox.min) < 2e-3 && origBox.max.distanceTo(skBox.max) < 2e-3;
const fmt = (b: THREE.Box3) => `min[${b.min.toArray().map((n) => n.toFixed(3)).join(',')}] max[${b.max.toArray().map((n) => n.toFixed(3)).join(',')}]`;

console.log(`\nSKINNED VERIFY · ${id}`);
console.log(`  DRAWS:  ${origMeshes} meshes → ${draws} material groups   [${(origMeshes / draws).toFixed(1)}× fewer]`);
console.log(`  verts ${pos.count}   bones ${sk.skeleton.bones.length}`);
console.log(`  orig    ${fmt(origBox)}`);
console.log(`  skinned ${fmt(skBox)}`);
console.log(`  BIND POSE: ${ok ? '✓ skinned matches original — bind correct' : '✗ MISMATCH — bind/skin math off'}`);
process.exit(ok ? 0 : 1);
