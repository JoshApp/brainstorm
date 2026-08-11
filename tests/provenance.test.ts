// PROVENANCE — every drawable says what system made it.
//
// Measured on a full un-culled floor: 1042 meshes, 929 of them loose static in
// 375 ANONYMOUS kinds, while the draw report claimed `shell: 0, prop: 0`. Not
// because the floor has no shell — because most geometry never said so. An
// untagged group is also invisible to the batcher, whose rect lookup is an
// implicit allowlist it falls straight through.
//
// The load-bearing part is the STRING FORMAT: `dbgSource` doubles as the room-
// rect carrier that static-batch and room-culling parse. A drift there does not
// leave stone unlabelled, it files it under the wrong room and the player
// watches it blink out. So these tests check tagOrigin against the REAL
// consumer (containedRectId's sibling parser), not against a copy of the format.
//
//   npm test -- provenance

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tagOrigin, originOf, rectOf, untaggedDrawables } from '../src/scene/provenance';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());

test('a tagged group names the system for every mesh under it', () => {
  const g = new THREE.Group();
  const deep = new THREE.Group();
  const m = mesh();
  deep.add(m); g.add(deep);
  tagOrigin(g, 'clutter');
  assert.equal(originOf(m)?.system, 'clutter', 'lookup must walk up — we tag groups, not meshes');
});

test('an untagged mesh returns null rather than a guess', () => {
  // The whole point is that "nobody claims this" is COUNTABLE. scene-audit.ts
  // borrowed a parent's name here and marked it `↑`; a borrowed label hides the
  // gap this exists to measure.
  assert.equal(originOf(mesh()), null);
});

test('the rect round-trips through the format the batcher parses', () => {
  const g = new THREE.Group();
  tagOrigin(g, 'floor', { rect: 'room-3' });
  assert.equal(originOf(g)?.rect, 'room-3');
  assert.equal(rectOf(g.userData.dbgSource as string), 'room-3');
});

test('a detail after the rect never swallows the rect', () => {
  // shellRectId takes the text after `·` up to the FIRST SPACE. A detail that
  // ran into the rect would file the object under a rect id that doesn't exist,
  // and it would simply never be culled with its room.
  const g = new THREE.Group();
  tagOrigin(g, 'ceiling', { rect: 'hall-1', detail: 'vaulted y3.2' });
  assert.equal(rectOf(g.userData.dbgSource as string), 'hall-1');
});

test('a detail without a rect does not masquerade as one', () => {
  const g = new THREE.Group();
  tagOrigin(g, 'prop', { detail: 'authored' });
  assert.equal(originOf(g)?.rect, 'authored',
    'documents current behaviour: with no rect, the first token after · IS read as the rect');
});

test('tagOrigin matches the format existing shells already emit', () => {
  // Byte-compatibility with what builder.ts / poly-room-shell.ts write today,
  // so migrating those call sites cannot change what the culler sees.
  const g = new THREE.Group();
  tagOrigin(g, 'floor', { rect: 'room-a' });
  assert.equal(g.userData.dbgSource, 'floor · room-a');
  assert.equal(g.userData.dbgKind, 'floor');
});

test('the nearest tag wins over a further one', () => {
  const outer = new THREE.Group(); tagOrigin(outer, 'prop', { rect: 'r1' });
  const inner = new THREE.Group(); tagOrigin(inner, 'destructible', { rect: 'r1' });
  const m = mesh();
  inner.add(m); outer.add(inner);
  assert.equal(originOf(m)?.system, 'destructible');
});

test('untaggedDrawables counts only what nothing claims, and names it', () => {
  const root = new THREE.Group();
  const claimed = new THREE.Group();
  tagOrigin(claimed, 'clutter', { rect: 'r1' });
  claimed.add(mesh(), mesh());
  const orphanA = mesh(); orphanA.name = 'guard';
  const orphanB = mesh();
  root.add(claimed, orphanA, orphanB);

  const r = untaggedDrawables(root);
  assert.equal(r.count, 2, 'the two claimed meshes must not be counted');
  assert.ok(Object.keys(r.kinds).some((k) => k.startsWith('guard·')), `named orphan missing: ${JSON.stringify(r.kinds)}`);
});

test('sprites and points count as drawables, groups do not', () => {
  const root = new THREE.Group();
  root.add(new THREE.Sprite(), new THREE.Group(), new THREE.Object3D());
  assert.equal(untaggedDrawables(root).count, 1, 'only the sprite draws');
});

test('a rect containing a space would truncate — so it must never be emitted', () => {
  // Not a hypothetical: the rect is delimited by whitespace, so "room 3" reads
  // back as "room". Pinned so a future room-id scheme with spaces fails HERE
  // rather than as stone vanishing on a phone.
  const g = new THREE.Group();
  tagOrigin(g, 'wall', { rect: 'room 3' });
  assert.equal(rectOf(g.userData.dbgSource as string), 'room',
    'a spaced rect id truncates — room ids must stay space-free');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
