// Content-load smoke. The ONE class of bug tsc + `vite build` can't catch:
// a module that throws at RUNTIME init (neither typechecks the throw nor
// executes the module). A reserved/duplicate enemy tile char does exactly
// this and white-screens the live game — it shipped once. Importing the
// registries here EXECUTES their module-load validation, so a clash fails
// `npm test` (and the pre-push hook) instead of the browser.
//
//   npm test
//
// NOTE: these are static imports on purpose — if a registry module throws at
// load, this file fails to even import and the run goes red, which is the
// signal we want.

import assert from 'node:assert/strict';
import { ENEMIES } from '../src/content/enemies';
import { ITEMS } from '../src/content/items';
import { BUFFS } from '../src/content/buffs';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('registries are non-empty', () => {
  assert.ok(Object.keys(ENEMIES).length > 0, 'no enemies');
  assert.ok(Object.keys(ITEMS).length > 0, 'no items');
  assert.ok(Object.keys(BUFFS).length > 0, 'no buffs');
});

test('every enemy id is internally consistent', () => {
  for (const [id, spec] of Object.entries(ENEMIES)) {
    assert.equal(spec.id, id, `ENEMIES['${id}'].id is '${spec.id}'`);
    if (spec.tileChar !== undefined) {
      assert.equal(spec.tileChar.length, 1, `enemy '${id}' tileChar must be 1 char`);
    }
  }
});


console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
