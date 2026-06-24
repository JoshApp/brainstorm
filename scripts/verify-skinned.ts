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
const origBox = new THREE.Box3().setFromObject(creature.group);
let origMeshes = 0;
creature.group.traverse((o) => { const m = o as THREE.Mesh & { isSprite?: boolean }; if (m.isMesh && m.isSprite !== true) origMeshes++; });

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

const ok = origBox.min.distanceTo(skBox.min) < 2e-3 && origBox.max.distanceTo(skBox.max) < 2e-3;
const fmt = (b: THREE.Box3) => `min[${b.min.toArray().map((n) => n.toFixed(3)).join(',')}] max[${b.max.toArray().map((n) => n.toFixed(3)).join(',')}]`;

console.log(`\nSKINNED VERIFY · ${id}`);
console.log(`  DRAWS:  ${origMeshes} meshes → ${draws} material groups   [${(origMeshes / draws).toFixed(1)}× fewer]`);
console.log(`  verts ${pos.count}   bones ${sk.skeleton.bones.length}`);
console.log(`  orig    ${fmt(origBox)}`);
console.log(`  skinned ${fmt(skBox)}`);
console.log(`  BIND POSE: ${ok ? '✓ skinned matches original — bind correct' : '✗ MISMATCH — bind/skin math off'}`);
process.exit(ok ? 0 : 1);
