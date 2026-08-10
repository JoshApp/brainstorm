// UPLOAD CENSUS — attribution of per-frame GPU upload calls.
//
// Four pooled phone recordings showed renderer CPU tracking the `ub` column
// (writeBuffer/writeTexture calls per frame) at r=+0.92, while draw calls
// managed +0.27. ~567 calls a frame at ~16µs each IS the ~9ms of render·scene.
// The census attributes those calls to call sites so the next recording says
// WHICH code is doing it.
//
// It can only run on the WebGPU backend, and this project's headless harness
// has no working WebGPU (every snap forces webgpu=0), so the device path cannot
// be exercised in CI. What CAN be — and what would actually be wrong — is the
// logic around it: that it wraps and UNWRAPS the queue, stops on schedule,
// aggregates by site, counts distinct buffers, and does nothing at all when
// there is no device. A fake queue exercises all of that against the real
// module (docs/DESIGN-METHOD.md: every audit tool imports the real function).
//
//   npm test -- upload-census

import assert from 'node:assert/strict';
import { armCensus, tickCensus, takeCensus, resetCensus } from '../src/debug/upload-census';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A renderer-shaped object with a queue we can watch. */
function fakeRenderer() {
  const calls: Array<{ dest: unknown; bytes: number }> = [];
  const queue = {
    writeBuffer(dest: unknown, _off: unknown, data: unknown, _do?: unknown, size?: number) {
      calls.push({ dest, bytes: size ?? (data as { byteLength?: number })?.byteLength ?? 0 });
    },
    writeTexture(dest: unknown, data: unknown) {
      calls.push({ dest, bytes: (data as { byteLength?: number })?.byteLength ?? 0 });
    },
  };
  return { renderer: { backend: { device: { queue } } }, queue, calls };
}

test('no device (WebGL2 backend) → arms nothing and reports nothing', () => {
  resetCensus();
  armCensus({ backend: {} }, 0);
  tickCensus(0); tickCensus(1); tickCensus(2);
  assert.equal(takeCensus(), null);
});

test('captures calls, then UNWRAPS itself after its frames', () => {
  resetCensus();
  const { renderer, queue, calls } = fakeRenderer();
  const original = queue.writeBuffer;
  armCensus(renderer, 0);
  assert.notEqual(queue.writeBuffer, original, 'queue should be wrapped while armed');

  const bufA = { id: 'A' }, bufB = { id: 'B' };
  queue.writeBuffer(bufA, 0, new Uint8Array(64));
  queue.writeBuffer(bufB, 0, new Uint8Array(128));
  tickCensus(0);
  queue.writeBuffer(bufA, 0, new Uint8Array(64));
  tickCensus(1);   // CENSUS_FRAMES = 2 → ends here

  const res = takeCensus();
  assert.ok(res, 'census should have produced a result');
  assert.equal(res!.frames, 2);
  assert.equal(res!.totalCalls, 3, 'all three writes counted');
  assert.ok(res!.sites.length >= 1, 'at least one call site attributed');
  // Leaving the queue wrapped would tax every later frame forever — the whole
  // point of a bounded census is that it takes its cost once.
  assert.equal(queue.writeBuffer, original, 'queue must be restored when the census ends');

  // Writes still reach the real queue while wrapped — an instrument that
  // swallowed uploads would silently break rendering.
  assert.equal(calls.length, 3, 'wrapped queue must still forward to the original');
  assert.equal(calls[1].bytes, 128, 'byte size forwarded intact');
});

test('does not keep counting after it ends', () => {
  resetCensus();
  const { renderer, queue } = fakeRenderer();
  armCensus(renderer, 0);
  queue.writeBuffer({ id: 'A' }, 0, new Uint8Array(8));
  tickCensus(0); tickCensus(1);
  const before = takeCensus()!.totalCalls;
  queue.writeBuffer({ id: 'A' }, 0, new Uint8Array(8));
  assert.equal(takeCensus()!.totalCalls, before, 'post-census writes must not be counted');
});

test('counts DISTINCT destination buffers, not just calls', () => {
  resetCensus();
  const { renderer, queue } = fakeRenderer();
  armCensus(renderer, 0);
  const one = { id: 'shared' };
  // Same buffer, written many times — the signal that separates "one buffer
  // rewritten per object" from "many buffers written once".
  for (let i = 0; i < 12; i++) queue.writeBuffer(one, 0, new Uint8Array(16));
  tickCensus(0); tickCensus(1);
  const res = takeCensus()!;
  assert.equal(res.totalCalls, 12);
  const totalBuffers = res.sites.reduce((n, s) => n + s.buffers, 0);
  assert.equal(totalBuffers, 1, `12 writes to one buffer should report 1 distinct buffer, got ${totalBuffers}`);
});

test('arming twice does not double-wrap', () => {
  resetCensus();
  const { renderer, queue, calls } = fakeRenderer();
  armCensus(renderer, 0);
  armCensus(renderer, 0);   // second arm must be a no-op
  queue.writeBuffer({ id: 'A' }, 0, new Uint8Array(4));
  tickCensus(0); tickCensus(1);
  assert.equal(takeCensus()!.totalCalls, 1, 'double-arm would count each write twice');
  assert.equal(calls.length, 1, 'double-wrap would forward each write twice');
});

test('resetCensus unwraps even mid-census', () => {
  resetCensus();
  const { renderer, queue } = fakeRenderer();
  const original = queue.writeBuffer;
  armCensus(renderer, 0);
  resetCensus();   // abandoned partway — must not leave the queue wrapped
  assert.equal(queue.writeBuffer, original);
  assert.equal(takeCensus(), null);
});

test('RE-ARMS, and the previous result stays readable until replaced', () => {
  // The census runs on a timer while the profiler ring rolls, because the
  // recordings people actually take are SAVE LAST 15s snapshots of a ring that
  // filled before the button was pressed — arming once at record-start
  // attributed nothing at all (measured: the first recording on the census
  // build came back empty). So a second arm must work, and a snapshot taken
  // between censuses must still find the previous one.
  resetCensus();
  const { renderer, queue } = fakeRenderer();
  const raw = queue.writeBuffer;

  armCensus(renderer, 0);
  queue.writeBuffer({ id: 'A' }, 0, new Uint8Array(4));
  tickCensus(0); tickCensus(1);
  assert.equal(takeCensus()!.totalCalls, 1);

  // Between censuses the queue is clean and the old result is still there.
  assert.equal(queue.writeBuffer, raw, 'queue must be unwrapped between censuses');
  assert.equal(takeCensus()!.totalCalls, 1, 'result must survive until replaced');

  armCensus(renderer, 10);
  queue.writeBuffer({ id: 'B' }, 0, new Uint8Array(4));
  queue.writeBuffer({ id: 'C' }, 0, new Uint8Array(4));
  tickCensus(10); tickCensus(11);
  const res = takeCensus()!;
  assert.equal(res.totalCalls, 2, 'second census replaces the first, not adds to it');
  assert.deepEqual(res.censusFrames, [10, 11], 'reports the frames it actually ran on');
  assert.equal(queue.writeBuffer, raw, 'still unwrapped after the second census');
});

resetCensus();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
