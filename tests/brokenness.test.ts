// applyBrokenness — the half-broken art pass. Pins the invariants that keep it
// SAFE to apply to any event prop: deterministic given a seeded rand, protects
// the largest part (never chips/hides the body), drops at most one piece, and
// touches only transforms (no material edits — pooled materials are shared).
//
//   npm test

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyBrokenness } from '../src/interactables/brokenness';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function makeProp(): { group: THREE.Group; body: THREE.Mesh; parts: THREE.Mesh[] } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));   // biggest
  const parts = [body];
  group.add(body);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3));
    m.position.set(i, 0, 0);
    group.add(m); parts.push(m);
  }
  return { group, body, parts };
}

test('level 0 is a no-op', () => {
  const { group } = makeProp();
  applyBrokenness(group, 0, lcg(1));
  assert.equal(group.rotation.x, 0);
  for (const c of group.children) assert.equal((c as THREE.Mesh).rotation.x, 0);
});

test('deterministic given the same seed', () => {
  const a = makeProp(), b = makeProp();
  applyBrokenness(a.group, 0.7, lcg(42));
  applyBrokenness(b.group, 0.7, lcg(42));
  for (let i = 0; i < a.group.children.length; i++) {
    const ca = a.group.children[i] as THREE.Mesh, cb = b.group.children[i] as THREE.Mesh;
    assert.equal(ca.rotation.x, cb.rotation.x);
    assert.equal(ca.visible, cb.visible);
    assert.equal(ca.scale.x, cb.scale.x);
  }
});

test('the largest part is never hidden and never chipped', () => {
  // Run many seeds — the body must survive intact every time.
  for (let seed = 1; seed <= 50; seed++) {
    const { group, body } = makeProp();
    applyBrokenness(group, 1.0, lcg(seed));
    assert.equal(body.visible, true, `body hidden at seed ${seed}`);
    assert.equal(body.scale.x, 1, `body chipped at seed ${seed}`);
    assert.equal(body.scale.z, 1, `body chipped at seed ${seed}`);
  }
});

test('at most one part is dropped', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { group } = makeProp();
    applyBrokenness(group, 1.0, lcg(seed));
    const hidden = group.children.filter((c) => !(c as THREE.Mesh).visible).length;
    assert.ok(hidden <= 1, `dropped ${hidden} parts at seed ${seed}`);
  }
});

console.log(`brokenness: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
