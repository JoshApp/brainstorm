// The warm lock — the guard that stops two whole-scene warm passes from
// interleaving. Pure async logic, no browser globals, so it runs under tsx:
//
//   npm test -- warm-lock
//
// WHY THIS EXISTS. Three warm passes each snapshot every drawable's `visible`
// flag, mutate it scene-wide, and restore. Overlap two chains and each restore
// writes the OTHER's temporary state back as truth. Both stranding directions
// shipped: an idle projectile-pool slot left visible (a 2m unlit white sphere
// parked at the world origin, on every floor, because the pool lives on the
// Scene and outlived teardown), and floor geometry left hidden on the first
// level built after the title — the weapon-pick chamber rendering void.
//
// The property under test is the one that fixes both: NO TWO BODIES ARE EVER
// INSIDE THE LOCK AT THE SAME TIME. Everything else here defends that property
// against the ways a naive queue breaks it — a body that throws, a body that
// awaits, a caller that ignores the returned promise.

import assert from 'node:assert/strict';
import { withWarmLock, warmLockHolder } from '../src/content/warm-lock';

let passed = 0;
let failed = 0;
const tests: Array<[string, () => Promise<void>]> = [];
function test(name: string, fn: () => Promise<void>) { tests.push([name, fn]); }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test('two chains never overlap', async () => {
  let inside = 0;
  let maxInside = 0;
  const order: string[] = [];
  const chain = (label: string) => withWarmLock(label, async () => {
    inside++;
    maxInside = Math.max(maxInside, inside);
    order.push(label);
    // Yield the way a real pass does (compileAsync, warmRenderWebGPU, rAF).
    await tick();
    await tick();
    inside--;
  });
  // Start both WITHOUT awaiting the first — this is exactly the shape that
  // broke: the title vignette's chain still resolving while the boot warm
  // starts.
  await Promise.all([chain('title'), chain('boot')]);
  assert.equal(maxInside, 1, 'two warm bodies were inside the lock at once');
  assert.deepEqual(order, ['title', 'boot'], 'warms did not run in call order');
});

test('a throwing body releases the lock', async () => {
  await withWarmLock('boom', async () => { throw new Error('warm failed'); })
    .catch(() => { /* the caller handles its own failure */ });
  let ran = false;
  await withWarmLock('after', async () => { ran = true; });
  assert.ok(ran, 'a failed warm wedged the queue for every warm behind it');
});

test('a throwing body does not reject the NEXT body', async () => {
  // The queue chains onto the previous promise; if it chained onto the raw
  // (rejected) one, every subsequent warm would inherit the rejection.
  const first = withWarmLock('boom', async () => { throw new Error('warm failed'); });
  const second = withWarmLock('after', async () => 'ok');
  await first.catch(() => {});
  assert.equal(await second, 'ok');
});

test('the body\'s return value reaches the caller', async () => {
  assert.equal(await withWarmLock('value', async () => 42), 42);
});

test('holder reports who is inside, and clears after', async () => {
  assert.equal(warmLockHolder(), null, 'lock was held before any warm ran');
  let seen: string | null = null;
  await withWarmLock('floor:starter', async () => { seen = warmLockHolder(); });
  assert.equal(seen, 'floor:starter');
  assert.equal(warmLockHolder(), null, 'lock stayed held after the body returned');
});

test('a queued chain waits for a slow predecessor', async () => {
  const done: string[] = [];
  const slow = withWarmLock('slow', async () => {
    for (let i = 0; i < 5; i++) await tick();
    done.push('slow');
  });
  const fast = withWarmLock('fast', async () => { done.push('fast'); });
  await Promise.all([slow, fast]);
  assert.deepEqual(done, ['slow', 'fast'], 'a later warm jumped ahead of a slow one');
});

// ── Report ───────────────────────────────────────────────────────────────
for (const [name, fn] of tests) {
  try { await fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}`); console.error(`  ${(err as Error).message}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
