// SPENDING A FIRE — the beat that stopped happening when flames became instances.
//
// A claimed fate fire is supposed to collapse to cold embers. That read is the
// whole "already taken" signal: playtesting found a spent fire that merely got
// smaller still looked like a little fire you could rest at, so the COLOUR is
// load-bearing, not decoration.
//
// Then sprite batching landed. A bonfire built with `batchSprites` has no
// Sprites at all — each flame is a plain Object3D placeholder whose look lives
// in an instance buffer behind `userData.batchedSprite`. The collector looked
// for `isSprite`; the spender reached for `.material`. Both found nothing, and
// level/builder.ts had been building its bonfires that way and registering them
// as fate fires. The fire kept burning at full height and full brightness after
// you took its card, with no error and nothing in a log.
//
// These tests are written against BOTH shapes, so a future batching change that
// swaps one for the other fails here instead of on a phone.
//
//   npm test -- flame-spend

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectFlames, spendFlames, batchHandleOf } from '../src/level/flame-spend';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A batched flame as the batch actually builds it: a bare Object3D carrying the
 *  handle the instance buffer reads. Mirrors createBatchedSprite's return. */
function batchedFlame(color = 0xffa040, opacity = 1): THREE.Object3D {
  const obj = new THREE.Object3D();
  obj.name = 'sprite@0,0.3,0';   // auto-named, like build-model emits
  obj.userData.batchedSprite = { color: new THREE.Color(color), opacity };
  return obj;
}

function realSprite(color = 0xffa040): THREE.Sprite {
  return new THREE.Sprite(new THREE.SpriteMaterial({ color, opacity: 1, transparent: true }));
}

test('a batched bonfire is not invisible to the collector', () => {
  // THE BUG, stated as a test. Before the fix this returned [] for a whole
  // bonfire and spending it did nothing at all.
  const fire = new THREE.Group();
  for (let i = 0; i < 11; i++) fire.add(batchedFlame());
  assert.equal(collectFlames(fire).length, 11);
});

test('a spent batched flame gets smaller AND colder', () => {
  const f = batchedFlame(0xffa040, 1);
  const handle = batchHandleOf(f)!;
  const litColor = handle.color.clone();
  spendFlames([f]);
  assert.ok(f.scale.x < 0.5, `scale must collapse, got ${f.scale.x}`);
  assert.ok(handle.opacity! < 0.5, `opacity must drop, got ${handle.opacity}`);
  assert.ok(handle.color.getHex() !== litColor.getHex(), 'colour must cool — a smaller-but-bright fire still reads as restable');
  // Cold, not merely dimmer: the target is dark ash, so the red channel has to
  // have come a long way down from a lit orange.
  assert.ok(handle.color.r < litColor.r * 0.5, `expected ash, got r=${handle.color.r.toFixed(3)}`);
});

test('batched and unbatched fires spend to the same look', () => {
  // The two paths exist only because of how the renderer draws them; a player
  // must not be able to tell which bonfire they walked up to.
  const sprite = realSprite(0xffa040);
  const batched = batchedFlame(0xffa040, 1);
  spendFlames([sprite, batched]);
  const spriteMat = sprite.material as THREE.SpriteMaterial;
  const handle = batchHandleOf(batched)!;
  assert.equal(sprite.scale.x, batched.scale.x, 'same collapse');
  assert.ok(Math.abs(spriteMat.opacity - handle.opacity!) < 1e-6, 'same dimming');
  assert.ok(spriteMat.color.getHex() === handle.color.getHex(),
    `same ash: sprite ${spriteMat.color.getHexString()} vs batch ${handle.color.getHexString()}`);
});

test('flame MESHES are collected by name, batched or not', () => {
  const fire = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'flame';
  const blob = new THREE.Object3D();
  blob.userData.batchedFlame = { color: new THREE.Color(0xffa040) };
  fire.add(mesh, blob);
  assert.equal(collectFlames(fire).length, 2, 'the flame-mesh batch has its own handle key');
});

test('spending does not touch the stone the fire sits on', () => {
  const fire = new THREE.Group();
  const logs = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  logs.name = 'logs';
  fire.add(logs, batchedFlame());
  const flames = collectFlames(fire);
  assert.equal(flames.length, 1, 'only the fire, not the fuel');
  spendFlames(flames);
  assert.equal(logs.scale.x, 1, 'the log pile must not shrink with the flame');
});

test('a spent sprite material is CLONED, never mutated in place', () => {
  // Bonfire flame materials may be shared template-clones; dimming in place
  // would cool every other fire on the floor at the same time.
  const shared = new THREE.SpriteMaterial({ color: 0xffa040, opacity: 1, transparent: true });
  const a = new THREE.Sprite(shared);
  const b = new THREE.Sprite(shared);
  spendFlames([a]);
  assert.notEqual(a.material, shared, 'must swap in a clone');
  assert.equal(b.material, shared, 'the other fire must be untouched');
  assert.equal((b.material as THREE.SpriteMaterial).opacity, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
