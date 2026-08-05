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

/**
 * Best-of-N build time for a spec, in ms.
 *
 * The MINIMUM, not the mean — this runs on a shared box alongside a dev server
 * and 64 other test processes, and scheduler noise only ever ADDS time. The
 * minimum is the closest honest estimate of what the computation costs; a mean
 * measures the machine's mood. Using a mean here is what made this file flaky
 * enough to abort two pushes on 2026-08-05.
 */
function buildMs(spec: Parameters<typeof buildModel>[0], n = 5): number {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    buildModel(spec);
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

test('A REPEAT BUILD OF A BOOLEAN IS CHEAP', () => {
  // The property the cache exists for, measured against a BASELINE rather than
  // against the same model's "first" build.
  //
  // The first version of this test compared to a cold build — and there is no
  // cold build available here, because the `items` filter above already built
  // every drop model to find out which ones need a DOM. So it was comparing warm
  // to warm and asserting on the noise between them. That is DESIGN-METHOD §2
  // again, self-inflicted: the scope filter was added AFTER the ratio test and
  // silently invalidated its premise.
  //
  // What's meaningful instead: a CSG-bearing model, warm, should cost about what
  // an ordinary model costs. If the boolean were re-running it would be an order
  // of magnitude more (measured: 37ms vs ~1ms before the cache). This ratio is
  // between two things timed under identical conditions, so it holds on any box.
  const plain = items.filter((i) => !containsCsg(i.dropModel));
  const baseline = median(plain.map((i) => buildMs(i.dropModel)));

  for (const item of csgItems) {
    const spec = containsCsg(item.dropModel) ? item.dropModel : item.viewmodel!;
    const ms = buildMs(spec);
    assert.ok(ms < Math.max(3, baseline * 12),
      `${item.id}: ${ms.toFixed(2)}ms warm vs a ${baseline.toFixed(2)}ms median plain model — ` +
      `that is boolean-shaped, so the CSG cache is not being hit`);
  }
});

test('NO ITEM MODEL IS A FRAME-KILLER ONCE WARM', () => {
  // The player-facing claim: after boot, putting any item on the floor fits in a
  // frame. 16ms is the 60fps budget. The threshold is deliberately loose (and
  // best-of-N) because this is a REGRESSION guard, not a benchmark — it should
  // fire when someone authors a 200-segment lathe, not when the box is busy.
  for (const item of items) {
    const ms = buildMs(item.dropModel, 3);
    assert.ok(ms < 8,
      `${item.id}: ${ms.toFixed(1)}ms to build its drop model even warm — that is a visible hitch when it drops`);
  }
});

test('the whole item catalogue stays cheap on average', () => {
  // Bounds the AVERAGE, so one new expensive model shows up here long before a
  // player feels it. Best of three passes, same reasoning as buildMs.
  let best = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    const t = performance.now();
    for (const item of items) buildModel(item.dropModel);
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(best / items.length < 1.5,
    `${(best / items.length).toFixed(2)}ms average per item drop model (${best.toFixed(0)}ms for ${items.length})`);
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
