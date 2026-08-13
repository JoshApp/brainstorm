// GPU READBACK LAYOUT — pin both axes the backends disagree on.
//
// Two shipped bugs came out of assuming one layout:
//   · row ORDER — the flip was applied unconditionally, so every bug-report
//     screenshot on WebGPU (the backend we ship) arrived upside down.
//   · row STRIDE — WebGPU requires bytesPerRow to be a multiple of 256 and
//     three returns the padded buffer as-is. Never considered anywhere.
//
// The stride bug is the nastier one because it HIDES AT THE WIDTHS WE HAPPENED
// TO USE. 1280·4 = 5120 = 20×256 and 960·4 = 3840 = 15×256, both clean, so the
// desktop snap and the bug-report capture looked perfect. The LUX meter's 240px
// (960 bytes against a 1024-byte stride) and a phone-width 844px snap are torn.
// So these cases test BOTH: an aligned width must stay untouched, and an
// unaligned one must be repacked.
//
//   npm test -- readback-layout

import assert from 'node:assert/strict';
import { normalizeReadback, webgpuBytesPerRow } from '../src/style/readback';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Row y is painted with the value y+1, so row order is readable from the data. */
function packed(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(width * 4 * height);
  for (let y = 0; y < height; y++) buf.fill(y + 1, y * width * 4, (y + 1) * width * 4);
  return buf;
}

/** What three's WebGPU copyTextureToBuffer hands back: 256-aligned rows, top-down,
 *  and sized (height-1)*stride + rowBytes — the last row carries no padding. */
function webgpuPadded(width: number, height: number): Uint8Array {
  const stride = webgpuBytesPerRow(width);
  const rowBytes = width * 4;
  const buf = new Uint8Array((height - 1) * stride + rowBytes);
  for (let y = 0; y < height; y++) buf.fill(y + 1, y * stride, y * stride + rowBytes);
  return buf;
}

function rowValues(data: Uint8Array, width: number, height: number): number[] {
  return Array.from({ length: height }, (_, y) => data[y * width * 4]);
}

test('WEBGL2 IS FLIPPED TO TOP-DOWN', () => {
  const out = normalizeReadback(packed(4, 3), 4, 3, 'webgl2');
  // gl.readPixels row 0 is the BOTTOM, so the last source row must come first.
  assert.deepEqual(rowValues(out, 4, 3), [3, 2, 1]);
});

test('WEBGPU KEEPS ITS ROW ORDER', () => {
  const out = normalizeReadback(packed(64, 3), 64, 3, 'webgpu');   // 64·4 = 256, aligned
  assert.deepEqual(rowValues(out, 64, 3), [1, 2, 3]);
});

test('WEBGPU PADDING IS STRIPPED AT AN UNALIGNED WIDTH (the LUX meter: 240px)', () => {
  assert.equal(webgpuBytesPerRow(240), 1024, 'sanity: 240·4 = 960 pads up to 1024');
  const out = normalizeReadback(webgpuPadded(240, 5), 240, 5, 'webgpu');
  assert.equal(out.length, 240 * 4 * 5, 'output must be tightly packed');
  assert.deepEqual(rowValues(out, 240, 5), [1, 2, 3, 4, 5], 'rows sheared by the stride');
});

test('A PHONE-WIDTH SNAP (844px) IS REPACKED, ROW FOR ROW', () => {
  const w = 844, h = 6;
  assert.notEqual(webgpuBytesPerRow(w), w * 4, 'sanity: 844 is an unaligned width');
  const out = normalizeReadback(webgpuPadded(w, h), w, h, 'webgpu');
  // Every byte of every row, not just the first — a stride bug shifts the tail.
  for (let y = 0; y < h; y++) {
    const row = out.subarray(y * w * 4, (y + 1) * w * 4);
    assert.ok(row.every((v) => v === y + 1), `row ${y} carries padding or a neighbour`);
  }
});

test('AN ALIGNED WEBGPU WIDTH IS PASSED THROUGH UNCOPIED', () => {
  // 1280·4 = 5120 = 20×256 — the desktop snap width, which is why this was
  // invisible for so long. No repack needed, so don't allocate one.
  const src = packed(1280, 2);
  assert.equal(normalizeReadback(src, 1280, 2, 'webgpu'), src);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
