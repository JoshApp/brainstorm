// disposeBuiltTree — the teardown for a built model tree.
//
// The rule this file exists for: A THREE.Sprite's geometry is a MODULE-LEVEL
// SINGLETON. Every sprite ever constructed, in every scene, in every renderer,
// shares one object. Disposing it deletes the GPU buffers out from under every
// other sprite in the process, and the next frame errors once per sprite draw —
// which the context-recovery watchdog reads as a dead device and veils with
// "something below has shifted".
//
// That was the ember-pickup crash: taking an ember built its inventory
// thumbnail, tore that rig down through here, and killed every flame in the
// dungeon. It is a whole-game outage produced by one line of cleanup, so it
// gets a test.
//
//   npm test

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeBuiltTree } from '../src/style/material-registry';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Geometry.dispose() is observable only as an event, so count them. */
function watchDispose(geo: THREE.BufferGeometry): () => number {
  let n = 0;
  geo.addEventListener('dispose', () => { n++; });
  return () => n;
}

test('THE SPRITE GEOMETRY IS SHARED — the premise of everything below', () => {
  const a = new THREE.Sprite(new THREE.SpriteMaterial());
  const b = new THREE.Sprite(new THREE.SpriteMaterial());
  assert.equal(a.geometry, b.geometry,
    'three no longer shares one sprite geometry — this guard may be obsolete');
});

test('tearing down a model with a sprite does not free the shared geometry', () => {
  const group = new THREE.Group();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
  group.add(sprite);
  const disposed = watchDispose(sprite.geometry);

  disposeBuiltTree(group);

  assert.equal(disposed(), 0,
    'the shared sprite geometry was disposed — every other sprite in the process is now broken');
});

test('a sprite in the tree does not shield the real meshes around it', () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  group.add(mesh);
  group.add(new THREE.Sprite(new THREE.SpriteMaterial()));
  const disposed = watchDispose(mesh.geometry);

  disposeBuiltTree(group);

  assert.equal(disposed(), 1, 'bespoke mesh geometry leaked');
});

test('a sprite nested under a mesh is still spared', () => {
  // Wisps hang off a part, not off the root — the guard has to survive depth.
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
  mesh.add(sprite);
  group.add(mesh);
  const spriteDisposed = watchDispose(sprite.geometry);
  const meshDisposed = watchDispose(mesh.geometry);

  disposeBuiltTree(group);

  assert.equal(spriteDisposed(), 0, 'a nested sprite freed the shared geometry');
  assert.equal(meshDisposed(), 1, 'the parent mesh geometry leaked');
});

test("the sprite's own material is still freed — only the geometry is shared", () => {
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial();
  let matDisposed = 0;
  mat.addEventListener('dispose', () => { matDisposed++; });
  group.add(new THREE.Sprite(mat));

  disposeBuiltTree(group);

  assert.equal(matDisposed, 1, 'sprite materials are per-instance and must be freed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
