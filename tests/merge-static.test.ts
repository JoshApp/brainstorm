// MERGE STATIC SUBTREE — an interactable is ONE thing built from many meshes.
//
// The floor batcher deliberately excludes interactables (they need identity for
// tap-targeting, state and removal), and a skip tally proved they are 70% of
// everything left loose on a floor — a staircase alone was 88 meshes. So the
// win is INSIDE each object, not across them.
//
// These tests pin the two properties that make that safe: geometry lands where
// it started, and nothing the game holds a reference to is merged away or
// silently deleted.
//
//   npm test -- merge-static

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeStaticSubtree, mergeInteractableStatics } from '../src/ecs/merge-static';
import type { BuiltModel } from '../src/ecs/build-model';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const mat = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial(o);
function box(m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function meshCount(o: THREE.Object3D): number {
  let n = 0; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
}
/** World-space bounding box of everything drawable under a root. */
function worldBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) b.expandByObject(o); });
  return b;
}

test('meshes sharing a material collapse into one', () => {
  const root = new THREE.Group();
  const m = mat();
  root.add(box(m, 0, 0, 0), box(m, 2, 0, 0), box(m, 4, 0, 0));
  const res = mergeStaticSubtree(root);
  assert.equal(res.before, 3);
  assert.equal(res.after, 1, 'three boxes of one material should be one mesh');
});

test('the merged geometry occupies the same world space it did before', () => {
  const root = new THREE.Group();
  root.position.set(5, 1, -3);
  root.rotation.y = 0.7;                       // a rotated parent is where baking goes wrong
  const m = mat();
  root.add(box(m, 0, 0, 0), box(m, 2, 0, 0));
  const bBefore = worldBounds(root);
  mergeStaticSubtree(root);
  const bAfter = worldBounds(root);
  assert.ok(bBefore.min.distanceTo(bAfter.min) < 1e-6 && bBefore.max.distanceTo(bAfter.max) < 1e-6,
    `merged geometry moved: ${JSON.stringify(bBefore.min)} → ${JSON.stringify(bAfter.min)}`);
});

test('different material INSTANCES never share a merged mesh', () => {
  // Runtime code mutates a specific instance (built.materials.get('rune').emissive).
  // Folding a mesh onto a look-alike instance would silently stop it responding.
  const root = new THREE.Group();
  const a = mat({ color: 0x808080 }), b = mat({ color: 0x808080 });   // identical VALUES
  root.add(box(a, 0, 0, 0), box(a, 1, 0, 0), box(b, 2, 0, 0), box(b, 3, 0, 0));
  mergeStaticSubtree(root);
  assert.equal(meshCount(root), 2, 'two instances → two merged meshes, not one');
});

test('a boundary keeps its own mesh — the chest lid still opens', () => {
  const root = new THREE.Group();
  const m = mat();
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.add(box(m, 0, 1, 0), box(m, 1, 1, 0));
  root.add(box(m, 0, 0, 0), box(m, 1, 0, 0), lid);
  mergeStaticSubtree(root, { boundaries: [lid] });
  assert.equal(meshCount(lid), 1, "the lid's own meshes merge with each other");
  assert.equal(meshCount(root), 2, 'but never across the boundary into the body');
  // The proof it still works: move the lid, and only the lid's geometry moves.
  const bodyBefore = worldBounds(root).min.y;
  lid.position.y = 10;
  assert.ok(worldBounds(lid).min.y > 9, 'lid geometry follows the lid');
  assert.equal(worldBounds(root).min.y, bodyBefore, 'body geometry does not');
});

test('an AUTHORED-named node is a boundary without being declared', () => {
  // A name is how the codebase finds a part; treat it as a reference.
  const root = new THREE.Group();
  const m = mat();
  const named = box(m, 0, 5, 0);
  named.name = 'hinge';
  root.add(box(m, 0, 0, 0), box(m, 1, 0, 0), named);
  mergeStaticSubtree(root);
  assert.ok(root.children.includes(named), 'a named mesh must survive the merge intact');
});

test('an auto-named node is NOT protected (debug labels are not references)', () => {
  const root = new THREE.Group();
  const m = mat();
  const auto = box(m, 0, 5, 0);
  auto.name = 'dbg-brick-17';
  auto.userData.autoName = true;
  root.add(box(m, 0, 0, 0), auto);
  mergeStaticSubtree(root);
  assert.equal(meshCount(root), 1, 'autoName is a label, so it should still merge');
});

test('THE CHILD-SURVIVAL RULE: merging a parent must not delete its children', () => {
  // Both older merge passes call removeFromParent() on a merged mesh, which
  // takes its children with it — silently. A glow plane or a spawn slot
  // parented to a stair block would simply stop existing.
  const root = new THREE.Group();
  const m = mat();
  const parent = box(m, 0, 0, 0);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat({ transparent: true }));
  glow.position.set(0, 3, 0);                  // local to parent → world y = 3
  parent.add(glow);
  root.add(parent, box(m, 1, 0, 0));

  mergeStaticSubtree(root);

  root.updateMatrixWorld(true);
  const stillThere = new THREE.Vector3();
  let found = false;
  root.traverse((o) => { if (o === glow) { found = true; o.getWorldPosition(stillThere); } });
  assert.ok(found, 'the transparent child was deleted along with its merged parent');
  assert.ok(Math.abs(stillThere.y - 3) < 1e-6, `child moved: world y ${stillThere.y}, expected 3`);
});

test('a surviving child keeps its world transform under a rotated parent', () => {
  const root = new THREE.Group();
  const m = mat();
  const parent = box(m, 2, 0, 0);
  parent.rotation.set(0.4, -0.9, 0.2);
  parent.scale.set(2, 2, 2);
  const slot = new THREE.Object3D();
  slot.name = 'loot_spawn';
  slot.position.set(0, 1, 0.5);
  parent.add(slot);
  root.add(parent, box(m, 4, 0, 0));

  root.updateMatrixWorld(true);
  const before = slot.getWorldPosition(new THREE.Vector3());
  mergeStaticSubtree(root);
  root.updateMatrixWorld(true);
  const after = slot.getWorldPosition(new THREE.Vector3());
  assert.ok(before.distanceTo(after) < 1e-6, `slot moved ${before.distanceTo(after)}m`);
});

test('THE SCOPE RULE: meshes never merge across a group, even an unnamed one', () => {
  // stairs.ts writes `wardGroup.visible = sealActive` on an UNNAMED group to
  // hide the boss seal. Merge its meshes up into the staircase root and that
  // line silently stops working — the seal is drawn over an open door and
  // nothing errors. The author's grouping IS the safety boundary.
  const root = new THREE.Group();
  const m = mat();
  const ward = new THREE.Group();               // deliberately unnamed
  ward.add(box(m, 0, 0, 0), box(m, 1, 0, 0));
  root.add(ward, box(m, 2, 0, 0), box(m, 3, 0, 0));
  mergeStaticSubtree(root);
  assert.equal(meshCount(ward), 1, "the ward's own meshes merge together");
  assert.equal(root.children.filter((c) => (c as THREE.Mesh).isMesh).length, 1,
    'the root merged its own two, and did NOT absorb the ward');
  // The proof: one assignment still hides exactly the ward.
  ward.visible = false;
  let visibleMeshes = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && (o.parent?.visible ?? true)) visibleMeshes++; });
  assert.equal(visibleMeshes, 1, 'hiding the group must still hide everything it held');
});

test('transparent, hidden and flame meshes stay loose', () => {
  const root = new THREE.Group();
  const m = mat();
  const clear = box(mat({ transparent: true }), 0, 0, 0);
  const clear2 = box(mat({ transparent: true }), 1, 0, 0);
  const hidden = box(m, 2, 0, 0); hidden.visible = false;
  const flame = box(m, 3, 0, 0); flame.name = 'flame';
  root.add(clear, clear2, hidden, flame, box(m, 4, 0, 0), box(m, 5, 0, 0));
  const res = mergeStaticSubtree(root);
  assert.ok(root.children.includes(clear) && root.children.includes(clear2), 'transparent must not merge');
  assert.ok(root.children.includes(hidden), 'a hidden mesh is controlled by something');
  assert.ok(root.children.includes(flame), 'the flame flickers');
  assert.ok(res.skipped['transparent (back-to-front ordering)'] === 2, 'the tally should say why');
});

test('shadow flags and renderOrder split buckets', () => {
  const root = new THREE.Group();
  const m = mat();
  const a = box(m, 0, 0, 0), b = box(m, 1, 0, 0);
  b.castShadow = true;                          // a caster must not be merged into a non-caster
  const c = box(m, 2, 0, 0), d = box(m, 3, 0, 0);
  d.renderOrder = 2;
  root.add(a, b, c, d);
  mergeStaticSubtree(root);
  // a+c merge (both default); b and d are alone in their buckets and stay put.
  assert.ok(root.children.includes(b), 'the shadow caster kept its own mesh');
  assert.ok(root.children.includes(d), 'the renderOrder override kept its own mesh');
});

test('mergeInteractableStatics treats parts and slots as boundaries and rebuilds hitTargets', () => {
  const group = new THREE.Group();
  const m = mat();
  const lid = new THREE.Group(); lid.name = 'lid';
  lid.add(box(m, 0, 1, 0), box(m, 1, 1, 0));
  const bodyA = box(m, 0, 0, 0), bodyB = box(m, 1, 0, 0);
  group.add(bodyA, bodyB, lid);
  const built: BuiltModel = {
    group,
    parts: new Map([['lid', lid as THREE.Object3D]]),
    slots: new Map(),
    materials: new Map(),
    hitTargets: [bodyA, bodyB],
  };
  mergeInteractableStatics(built);
  assert.equal(meshCount(group), 2, 'body merges to one, lid merges to one');
  assert.ok(built.hitTargets.length > 0, 'hitTargets must not be left empty');
  for (const t of built.hitTargets) {
    assert.ok((t as THREE.Mesh).parent, 'a rebuilt hit target must still be in the tree');
  }
  assert.ok(!built.hitTargets.includes(bodyA), 'the detached original must not linger as a hit target');
});

test('a merge of one is not performed', () => {
  const root = new THREE.Group();
  root.add(box(mat(), 0, 0, 0));
  const res = mergeStaticSubtree(root);
  assert.equal(res.after, 1);
  assert.ok(res.skipped['lone mesh for its material (a merge of one saves nothing)'] === 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
