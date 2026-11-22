// Every weapon's viewmodel merges without changing what it draws.
//
// mergeWeaponViewmodel (player/viewmodel-merge.ts) bakes each part's colour,
// emissive and surface scalars into vertex attributes and folds the weapon into
// one mesh per shading family. For EVERY item with a viewmodel this checks the
// merge kept the weapon exactly: the same triangles, the same bounds, and every
// baked vertex colour one of the colours the parts had. It also prints what
// each weapon now costs in draws.
//
//   npm test -- weapon-merge

import './support/vite-assets';
import '../src/headless/dom-stub';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { ITEMS } = await import('../src/content/items');
const { buildModel } = await import('../src/ecs/build-model');
const { mergeWeaponViewmodel, mergeRigidViewmodel } = await import('../src/player/viewmodel-merge');

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) out.push(o as THREE.Mesh); });
  return out;
}
function triangles(root: THREE.Object3D): number {
  let n = 0;
  for (const m of meshes(root)) {
    const g = m.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  return n;
}
function bounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

let checked = 0, failed = 0;
const rows: string[] = [];
const seen = new Set<unknown>();
for (const [id, item] of Object.entries(ITEMS)) {
  const spec = (item as { viewmodel?: unknown }).viewmodel;
  if (!spec || seen.has(spec)) continue;
  seen.add(spec);
  try {
    const built = buildModel(spec as Parameters<typeof buildModel>[0]);
    // The whip's bead chain ripples per frame; viewmodel.ts never merges it.
    if (built.parts.has('chain0')) { rows.push(`${id}: whip chain, not merged`); continue; }
    const beforeMeshes = meshes(built.group).length;
    const beforeTris = triangles(built.group);
    const beforeBox = bounds(built.group);
    const colours = new Set<string>();
    for (const m of meshes(built.group)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.color) colours.add(mat.color.getHexString());
    }

    mergeWeaponViewmodel(built.group);
    mergeRigidViewmodel(built.group, null, 'weapon-merged');

    const afterMeshes = meshes(built.group).length;
    assert.equal(triangles(built.group), beforeTris, `${id}: triangle count changed`);
    const afterBox = bounds(built.group);
    for (const k of ['min', 'max'] as const) {
      assert.ok(afterBox[k].distanceTo(beforeBox[k]) < 1e-4, `${id}: bounds moved (${k})`);
    }
    // Every baked vertex colour is one of the colours the parts had.
    for (const m of meshes(built.group)) {
      const c = m.geometry.attributes.color as THREE.BufferAttribute | undefined;
      if (!c || !(m.material as THREE.Material).userData.weaponBaked) continue;
      const tmp = new THREE.Color();
      for (let i = 0; i < c.count; i += Math.max(1, Math.floor(c.count / 64))) {
        tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i));
        assert.ok(colours.has(tmp.getHexString()), `${id}: baked colour #${tmp.getHexString()} not on any part`);
      }
    }
    assert.ok(afterMeshes <= beforeMeshes, `${id}: merge added draws`);
    rows.push(`${id}: ${beforeMeshes} → ${afterMeshes} draws`);
    checked++;
  } catch (e) {
    failed++;
    rows.push(`✗ ${id}: ${(e as Error).message}`);
  }
}
for (const r of rows) console.log('  ' + r);
console.log(`\n${checked} weapons merged cleanly, ${failed} failed`);
if (failed) process.exit(1);
