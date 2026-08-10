// SCENE AUDIT — the categoriser that names what is in the frame.
//
// Phone recordings put 158 of 356 meshes (44% of the scene) into buckets called
// "MeshStandardMaterial" and "MeshBasicMaterial" — the audit's fallback was the
// material's CLASS NAME, which identifies nothing. That is the largest category
// in the report and the least useful: at the measured ~16.6 µs of GPU upload per
// render object per frame, those 158 anonymous objects are ~2.6ms of every frame
// sitting in a bucket named after a class. You cannot instance, merge or batch
// what you cannot identify.
//
// These pin the naming so the audit stays able to answer "what ARE these".
//
//   npm test -- scene-audit

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditScene } from '../src/debug/scene-audit';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const mesh = (name = '') => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  m.name = name;
  return m;
};

test('a named mesh keeps its own name, digits stripped', () => {
  const root = new THREE.Group();
  root.add(mesh('vase-1'), mesh('vase-2'), mesh('vase-3'));
  const a = auditScene(root);
  assert.equal(a.byKind['vase']?.meshes, 3, 'trailing digits must collapse into one bucket');
});

test('an UNNAMED mesh inherits its nearest named ancestor', () => {
  // The whole point: a prop's sub-meshes are usually anonymous but hang under a
  // named group. Before this, all three landed in "MeshStandardMaterial".
  const root = new THREE.Group();
  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.add(mesh(), mesh(), mesh());
  root.add(chest);
  const a = auditScene(root);
  assert.equal(a.byKind['↑chest']?.meshes, 3, `expected 3 under ↑chest, got ${JSON.stringify(a.byKind)}`);
  assert.equal(a.byKind['MeshStandardMaterial'], undefined, 'must not fall back to the material class');
});

test('an inherited name is MARKED, never passed off as the real one', () => {
  // A borrowed label is a lead, not a fact — if it read identically to a real
  // name you could not tell which meshes actually declare themselves.
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.name = 'torch';
  g.add(mesh());
  root.add(g, mesh('torch'));
  const a = auditScene(root);
  assert.equal(a.byKind['torch']?.meshes, 1, 'the self-named mesh stays under its own key');
  assert.equal(a.byKind['↑torch']?.meshes, 1, 'the inherited one is a separate, marked key');
});

test('nested anonymity walks past unnamed groups to the real owner', () => {
  const root = new THREE.Group();
  const owner = new THREE.Group();
  owner.name = 'merchant';
  const a1 = new THREE.Group(), a2 = new THREE.Group();
  a2.add(mesh());
  a1.add(a2);
  owner.add(a1);
  root.add(owner);
  assert.equal(auditScene(root).byKind['↑merchant']?.meshes, 1);
});

test('with NOTHING named anywhere, reports the SHAPE not the material class', () => {
  // Grouping by form is the axis instancing cares about; "MeshStandardMaterial"
  // is not an axis of anything.
  const root = new THREE.Group();
  root.add(mesh(), mesh());
  const a = auditScene(root);
  assert.equal(a.byKind['anon:BoxGeometry']?.meshes, 2, JSON.stringify(a.byKind));
});

test('explicit debug tags still win over everything', () => {
  const root = new THREE.Group();
  const owner = new THREE.Group();
  owner.name = 'wrong';
  const m = mesh();
  m.userData.dbgKind = 'blood-decal';
  owner.add(m);
  root.add(owner);
  assert.equal(auditScene(root).byKind['blood-decal']?.meshes, 1);
});

test('hidden meshes are not counted — they are not drawn', () => {
  const root = new THREE.Group();
  const m = mesh('ghost');
  m.visible = false;
  root.add(m, mesh('ghost'));
  assert.equal(auditScene(root).byKind['ghost']?.meshes, 1);
});

test('instanced meshes report their instance count, not 1', () => {
  const root = new THREE.Group();
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 40);
  im.name = 'course';
  root.add(im);
  const a = auditScene(root);
  assert.equal(a.total.meshes, 1, 'one render object…');
  assert.equal(a.total.instances, 40, '…drawing forty things — the whole point of instancing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
