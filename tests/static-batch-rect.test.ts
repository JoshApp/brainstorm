// STATIC BATCH — which rect an unlabelled static group is filed under.
//
// batchStaticWorld reached 282 of a depth-3 floor's ~570 static meshes and
// batched 280 of them: 99% efficiency on what it SAW, and a gate that hid the
// rest. The gate was an implicit allowlist (destructible / dbgKind:'prop' /
// a "<kind> · <rect>" dbgSource); anything else — an unnamed 88-box masonry
// construct, an unnamed 40-piece arch, sixteen identical fixtures — fell
// through `continue` and paid a render object each, forever.
//
// Resolving those by BOUNDS is the fix, and the fit rule is the dangerous part.
// A rect id is not a label, it is what the room culler toggles: file a piece of
// stone under the wrong room and it BLINKS OUT while the player looks straight
// at it from the next one (the doorframe bug, room-culling.ts). So the rule has
// exactly two jobs, and both are pinned here:
//
//   - overhang into the VOID is fine   (masonry leans out of its room by design;
//                                       rejecting it threw away the biggest
//                                       groups on the floor)
//   - overlap into ANOTHER RECT is not (that is the vanishing-stone case)
//
//   npm test -- static-batch-rect

import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { LiveLevel } from '../src/level/builder';
import { containedRectId } from '../src/scene/static-batch';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// Two 10×10 rooms with a 4m gap of void between them (x: -15..-5 and 5..15).
const level = {
  spec: {
    rooms: [
      { id: 'west', rect: { x: -10, z: 0, w: 10, d: 10 } },
      { id: 'east', rect: { x: 10, z: 0, w: 10, d: 10 } },
    ],
    corridors: [],
  },
} as unknown as LiveLevel;

/** A box of the given world size, centred at (x, z). */
const boxAt = (x: number, z: number, w: number, d: number): THREE.Object3D => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), new THREE.MeshStandardMaterial());
  m.position.set(x, 0, z);
  m.updateMatrixWorld(true);
  return m;
};

test('a group well inside one room is filed under that room', () => {
  assert.equal(containedRectId(level, boxAt(-10, 0, 2, 2)), 'west');
  assert.equal(containedRectId(level, boxAt(10, 0, 2, 2)), 'east');
});

test('OVERHANG INTO THE VOID still resolves — this is the common case', () => {
  // A wall stands at the room edge and leans out of it. Requiring every corner
  // to land inside the rect rejected exactly the largest masonry groups on the
  // floor (measured: the +237 objects this test exists to protect).
  const wall = boxAt(-5, 0, 2, 10);   // straddles the west room's east edge
  assert.equal(containedRectId(level, wall), 'west');
});

test('OVERLAP INTO ANOTHER RECT is refused — the vanishing-stone case', () => {
  // Spans the whole floor, both rooms included. There is no correct single
  // answer, and a wrong one makes it disappear with whichever room it got.
  assert.equal(containedRectId(level, boxAt(0, 0, 34, 4)), null);
});

test('something entirely in the void resolves to nothing', () => {
  assert.equal(containedRectId(level, boxAt(0, 0, 1, 1)), null);
});

test('an empty group has no bounds and no rect', () => {
  assert.equal(containedRectId(level, new THREE.Group()), null);
});

test('the check is on the FOOTPRINT, so height never rejects anything', () => {
  // A pillar running floor to ceiling is as much a resident of its room as a
  // flagstone. Y must not enter the decision.
  const tall = new THREE.Mesh(new THREE.BoxGeometry(2, 40, 2), new THREE.MeshStandardMaterial());
  tall.position.set(-10, 20, 0);
  tall.updateMatrixWorld(true);
  assert.equal(containedRectId(level, tall), 'west');
});

test('nested children count, not just the group origin', () => {
  // A masonry group is routinely parented at the world origin with its meshes
  // placed absolutely — reading `child.position` would file the whole wall
  // under whatever rect contains (0,0), which here is the void.
  const g = new THREE.Group();          // sits at 0,0 — in NO room
  g.add(boxAt(10, 2, 2, 2), boxAt(10, -2, 2, 2));
  g.updateMatrixWorld(true);
  assert.equal(containedRectId(level, g), 'east');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
