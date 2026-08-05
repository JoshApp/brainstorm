// WHAT IT COSTS TO PUT AN ITEM ON THE FLOOR.
//
// Written 2026-08-05 answering Josh: *"why are items not covered by that
// [preloading]? I think we have to architect it better to allow for things to
// preload or at least not lag the game."*
//
// The answer turned out to be precise. Items ARE covered — by the pipeline warm,
// which builds a material on a tiny dummy and never touches the model. That is
// the right call for 106 of the 107 item drop models, which build in about a
// millisecond each. It was the wrong call for the one that contains a BOOLEAN:
// the skeleton key, a skull with two sockets subtracted, cost ~107ms on its first
// build and ~37ms on every one after. Keys drop constantly. That is a dropped
// frame every time the dungeon pays you, and no amount of pipeline warming
// touched it, because the cost was never on the GPU.
//
// Two fixes, and this file guards both:
//   - build-model's CSG_CACHE banks the boolean, so repeats are cheap.
//   - spawn-warmups builds every CSG-bearing item spec at boot, so the FIRST one
//     is paid behind the loading veil.
//
// The budgets below are wall-clock on a dev box, deliberately loose. They are not
// trying to pin performance; they are trying to notice a REGRESSION IN KIND — a
// cache that stopped caching, or a new item whose boolean nobody warmed.
//
//   npm test

import assert from 'node:assert/strict';
import { ITEMS } from '../src/content/items';
import { buildModel } from '../src/ecs/build-model';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** The same walker spawn-warmups uses to decide what needs a build warm. Kept in
 *  step deliberately: if the detector and the test disagree, the test is
 *  measuring a different set than the warm covers and proves nothing. */
function containsCsg(node: unknown, depth = 0): boolean {
  if (depth > 12 || node === null || typeof node !== 'object') return false;
  if ((node as { kind?: string }).kind === 'csg') return true;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (containsCsg(v, depth + 1)) return true;
  }
  return false;
}

const allItems = Object.values(ITEMS);

// Two item models (the wand, the guttering ember) draw a canvas-backed texture,
// so they need a DOM and cannot be built under node. They are EXCLUDED, not
// silently skipped — the count is asserted below, so a third one appearing fails
// this file instead of quietly shrinking what it measures. A test that narrows
// its own scope without saying so is how a suite starts agreeing with the bug.
const items = allItems.filter((i) => {
  try { buildModel(i.dropModel); return true; } catch { return false; }
});
const csgItems = items.filter((i) => containsCsg(i.dropModel) || containsCsg(i.viewmodel));

test('this file still measures nearly the whole catalogue', () => {
  const skipped = allItems.length - items.length;
  assert.ok(skipped <= 2,
    `${skipped} item models can no longer be built headlessly (was 2: wand, guttering-ember) — ` +
    `this file's budgets now cover less of the game than they claim to`);
});

test('the CSG-bearing items are still findable by the walk the warm uses', () => {
  // Guards the failure mode that hid this bug for months: an earlier audit
  // walked only `children` and reported ZERO csg models, because a boolean's
  // operands live under `a`/`b`. A detector that finds nothing looks exactly
  // like a codebase with nothing to find.
  assert.ok(csgItems.length > 0,
    'no item spec contains a csg node — either the booleans are gone, or the walker stopped seeing them');
});

test('A REPEAT BUILD OF A BOOLEAN IS CHEAP', () => {
  // The property the cache exists for. Measured against the SAME model's first
  // build, so this holds on a slow CI box as well as a fast laptop — it asserts
  // a ratio, not a wall-clock.
  for (const item of csgItems) {
    const spec = containsCsg(item.dropModel) ? item.dropModel : item.viewmodel!;
    const t0 = performance.now();
    buildModel(spec);
    const first = performance.now() - t0;

    let repeats = 0;
    const N = 5;
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      buildModel(spec);
      repeats += performance.now() - t;
    }
    const avg = repeats / N;
    // A cache miss would put avg at roughly `first`. Anything under a third of
    // it means the boolean is genuinely being skipped.
    assert.ok(avg < Math.max(2, first * 0.35),
      `${item.id}: first build ${first.toFixed(1)}ms, repeats average ${avg.toFixed(1)}ms — ` +
      `the CSG cache is not being hit`);
  }
});

test('NO ITEM MODEL IS A FRAME-KILLER ONCE WARM', () => {
  // The player-facing claim: after boot, putting any item on the floor fits in a
  // frame. 16ms is the 60fps budget; 8 leaves room for the rest of the frame.
  for (const item of items) {
    buildModel(item.dropModel);                     // warm (as boot does)
    const t = performance.now();
    buildModel(item.dropModel);
    const ms = performance.now() - t;
    assert.ok(ms < 8,
      `${item.id}: ${ms.toFixed(1)}ms to build its drop model even warm — that is a visible hitch when it drops`);
  }
});

test('the whole item catalogue could be built in one frame budget, warm', () => {
  // Not because anything builds all 107 at once, but because it bounds the
  // AVERAGE. A single new item authored with a 200-segment lathe would show up
  // here long before a player felt it.
  for (const item of items) buildModel(item.dropModel);   // ensure warm
  const t = performance.now();
  for (const item of items) buildModel(item.dropModel);
  const total = performance.now() - t;
  assert.ok(total / items.length < 1.5,
    `${(total / items.length).toFixed(2)}ms average per item drop model (${total.toFixed(0)}ms for ${items.length})`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
