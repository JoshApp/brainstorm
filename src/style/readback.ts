// GPU→CPU PIXEL READBACK IS NOT THE SAME SHAPE ON BOTH BACKENDS.
//
// `readRenderTargetPixelsAsync` hands back whatever the backend's copy produced,
// and the two backends disagree on BOTH axes of layout. Everything downstream —
// the LUX meter's mean, the bug-report screenshot, the headless harness — wants
// one thing: tightly-packed, top-down RGBA. This is the one place that knows how
// to get there from either backend.
//
//  ── WebGL2 ── three reads with `gl.readPixels`:
//     · rows are tightly packed (stride = width * 4)
//     · row 0 is the BOTTOM of the image (the GL origin) → needs a vertical flip
//
//  ── WebGPU ── three reads with `copyTextureToBuffer`:
//     · row 0 is texture row 0, i.e. the TOP → no flip
//     · but WebGPU REQUIRES `bytesPerRow` to be a multiple of 256, so three
//       rounds it up and returns the PADDED buffer without unpacking it. Any
//       width where `width * 4` isn't already a multiple of 256 comes back
//       sheared — each row offset a little further than the last.
//
// Both were wrong in shipped code (2026-08-13). The flip was applied
// unconditionally, so every bug-report screenshot taken on WebGPU — the backend
// we ship — arrived upside down. The stride was never considered at all: 960px
// (the report width) happens to be a clean multiple and looked fine, while the
// LUX meter's 240px reads 960 bytes against a 1024-byte stride and had been
// averaging padding into its brightness measurement.
//
// Widths that hid it: 1280·4 = 5120 = 20×256. 960·4 = 3840 = 15×256.
// Widths that expose it: 240·4 = 960, 844·4 = 3376, 390·4 = 1560.

/** Bytes per row WebGPU will have used for a `width`-pixel RGBA copy. */
export function webgpuBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
}

/**
 * Normalise a raw readback into tightly-packed, top-down RGBA.
 *
 * Returns a new buffer when any repacking is needed, and the input untouched
 * when it already has the right layout (WebGPU at an aligned width).
 */
export function normalizeReadback(
  data: Uint8Array, width: number, height: number, backend: 'webgpu' | 'webgl2',
): Uint8Array {
  const rowBytes = width * 4;
  if (width <= 0 || height <= 0) return data;

  if (backend === 'webgl2') {
    // Tightly packed already; just turn it top-down.
    const out = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes;
      out.set(data.subarray(src, src + rowBytes), y * rowBytes);
    }
    return out;
  }

  const stride = webgpuBytesPerRow(width);
  if (stride === rowBytes) return data;   // aligned width — nothing to do
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const src = y * stride;
    // three sizes the buffer as (height-1)*stride + rowBytes, so the LAST row
    // carries no padding — subarray past the end would silently truncate.
    out.set(data.subarray(src, Math.min(src + rowBytes, data.length)), y * rowBytes);
  }
  return out;
}
