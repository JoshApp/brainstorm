// THE HIGHLIGHT MECHANIC — what it costs to walk past a thing.
//
// The interactable outline is an inverted hull, and building one is not cheap:
// per hull it clones every source geometry, drops the index, bakes a matrix,
// merges, then runs mergeVertices (a spatial hash over every vertex) and
// recomputes normals. It was doing that EVERY TIME an interactable crossed the
// nearby radius — so walking into a dressed room paid for every object at once,
// and walking back out and in paid for all of them again.
//
// Nothing about the geometry can change between those two moments (the sources
// are static; anything animated keeps its own hull under its own parent), so
// the second build was pure waste. These tests pin the three properties that
// make that true and keep it true:
//
//   1. a hull is built ONCE per interactable — leaving and returning is free
//   2. a frame builds a bounded number of NEW hulls, so a room full of them
//      can't land as one hitch — except the armed one, which is a signal
//   3. hulls are freed when the interactable is, not when the player walks off
//
//   npm test -- outline-cache

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateOutline, outlineStats, resetOutlineStats, clearAllOutlines } from '../src/interactables/outline';
import { registerInteractable, clearInteractables } from '../src/interactables/system';
import type { Interactable } from '../src/interactables/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A minimal interactable with real geometry — the hull builder needs meshes to
 *  merge, so a bare group would silently produce zero hulls and every
 *  assertion below would pass for the wrong reason. */
function fake(id: string, x: number, meshes = 3): Interactable {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  for (let i = 0; i < meshes; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
    m.position.set(i * 0.1, 0, 0);
    group.add(m);
  }
  group.position.set(x, 0, 0);
  // A real interactable's group is in the scene; the "is it gone?" check reads
  // `built.group.parent`, so an orphan group would read as destroyed.
  new THREE.Scene().add(group);
  return {
    id: id as Interactable['id'],
    position: new THREE.Vector3(x, 0, 0),
    radius: 2, promptLabel: 'USE', onUse: () => {},
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
}

const at = (x: number) => new THREE.Vector3(x, 0, 0);

function reset(): void {
  clearAllOutlines();
  clearInteractables();
  resetOutlineStats();
}

test('a hull is built once — walking away and back is free', () => {
  reset();
  const it = fake('a', 0);
  registerInteractable(it);

  updateOutline(it, 0.016, at(0));             // player on top of it
  const built = outlineStats();
  assert.ok(built.builds >= 1, 'nothing was built — the fixture has no mergeable geometry');
  assert.ok(built.hulls >= 1, 'built but no live hull');

  updateOutline(null, 0.016, at(50));          // walk far away
  assert.equal(outlineStats().hulls, 0, 'hulls must stop drawing when out of range');
  assert.equal(outlineStats().targets, 1, 'the entry must be KEPT, not dropped — that is the cache');

  updateOutline(it, 0.016, at(0));             // walk back
  const back = outlineStats();
  assert.equal(back.builds, built.builds, 'returning must not build again');
  assert.equal(back.rebuilds, 0, 'a rebuild is the exact bug this cache exists to prevent');
  assert.ok(back.cacheHits >= 1, 'the return should be recorded as a cache hit');
  assert.ok(back.hulls >= 1, 'hulls must come back visible');
});

test('the cached hull is the SAME geometry, not an equivalent one', () => {
  // If park/unpark quietly rebuilt, every count above would still look right
  // while the allocation churn — the thing that costs — carried on.
  reset();
  const it = fake('b', 0);
  registerInteractable(it);
  updateOutline(it, 0.016, at(0));
  const geoms = new Set<THREE.BufferGeometry>();
  it.built!.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.outline) geoms.add(m.geometry);
  });
  assert.ok(geoms.size >= 1, 'no hull to compare');

  updateOutline(null, 0.016, at(50));
  updateOutline(it, 0.016, at(0));
  it.built!.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.outline) {
      assert.ok(geoms.has(m.geometry), 'hull geometry was replaced — it was rebuilt after all');
    }
  });
});

test('a destroyed interactable frees its hull; a distant one keeps it', () => {
  reset();
  const near = fake('c', 0);
  const far = fake('d', 1);
  registerInteractable(near); registerInteractable(far);
  updateOutline(near, 0.016, at(0));
  updateOutline(far, 0.016, at(0));            // budget: both get built within two frames
  assert.equal(outlineStats().targets, 2);

  near.destroyed = true;
  updateOutline(far, 0.016, at(1));
  assert.equal(outlineStats().targets, 1, 'a destroyed interactable must not keep hulls alive');
});

test('one frame builds a bounded number of NEW hulls', () => {
  // Eight interactables come into range on the same frame when you step through
  // a door. Eight mergeVertices calls on one frame is a visible hitch; spread
  // over frames it is invisible, because the nearby rim fades in anyway.
  reset();
  const many = Array.from({ length: 8 }, (_, i) => fake(`m${i}`, i * 0.1));
  for (const m of many) registerInteractable(m);

  updateOutline(null, 0.016, at(0));
  const first = outlineStats().builds;
  assert.ok(first > 0 && first < 8, `one frame built ${first} of 8 — expected a budget, got a stampede`);

  for (let f = 0; f < 20; f++) updateOutline(null, 0.016, at(0));
  assert.equal(outlineStats().builds, 8, 'the rest must still arrive on later frames');
  assert.equal(outlineStats().rebuilds, 0);
});

test('the armed interactable never waits for the budget', () => {
  // The armed rim is the "press USE" signal. A frame of delay on it reads as lag,
  // so it jumps the queue that the faint nearby tier waits in.
  reset();
  const many = Array.from({ length: 8 }, (_, i) => fake(`n${i}`, i * 0.1));
  for (const m of many) registerInteractable(m);
  const armed = many[7];

  updateOutline(armed, 0.016, at(0));
  let armedHulls = 0;
  armed.built!.group.traverse((o) => { if ((o as THREE.Mesh).userData.outline) armedHulls++; });
  assert.ok(armedHulls >= 1, 'the armed interactable must be outlined on the frame it arms');
});

test('a rim too faint to see is not drawn at all', () => {
  // The nearby tier fades to zero AT the radius, so the outermost band was
  // paying a full additive draw to add less than one 8-bit level.
  reset();
  const edge = fake('e', 3.95);   // just inside NEARBY_RADIUS (4.0)
  registerInteractable(edge);
  for (let f = 0; f < 10; f++) updateOutline(null, 0.016, at(0));
  assert.equal(outlineStats().builds, 0, 'a hull at the fade edge should never be built');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
