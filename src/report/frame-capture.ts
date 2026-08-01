// FRAME CAPTURE — a tiny seam so the bug-report tool can grab the current game
// frame + camera without importing the renderer/scene/camera (which live in
// main's boot scope). main.ts registers a provider once; the report reads it.
//
// The provider renders ONE frame through the real display pipeline into an
// offscreen target and reads it back with readRenderTargetPixelsAsync — the
// deterministic WebGPU-safe path. A WebGPU canvas CANNOT be snapshotted with
// canvas.toDataURL() (it reads BLACK — the swap chain isn't a 2D-readable
// surface), which is why the old sync toDataURL capture produced a blank
// screenshot on the live site. This is async for the same reason: the readback
// is a GPU→CPU round-trip. The game scene is rendered WITHOUT the DOM
// HUD/menus, so the shot is a clean view of the run.

export interface FrameContext {
  /** PNG data URL of the current frame, or null if the read failed. */
  png: string | null;
  /** Camera world position + yaw at capture time. */
  cameraPos: { x: number; y: number; z: number };
  yaw: number;
}

let provider: (() => Promise<FrameContext>) | null = null;

/** Called once from main's boot with a closure over renderer/scene/camera/canvas. */
export function registerFrameCapture(fn: () => Promise<FrameContext>): void {
  provider = fn;
}

/** Grab the current frame + camera, or null if no provider is registered yet. */
export async function captureFrameContext(): Promise<FrameContext | null> {
  if (!provider) return null;
  try {
    return await provider();
  } catch {
    return null;
  }
}

/** Convert a raw RGBA pixel buffer (as readRenderTargetPixelsAsync returns it —
 *  bottom-up rows, the GL origin) into a top-down PNG data URL via a 2D canvas. */
export function pixelsToPngDataURL(data: Uint8Array, width: number, height: number): string | null {
  if (!width || !height) return null;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const rowBytes = width * 4;
  // Flip vertically: source row 0 is the BOTTOM of the image (GL convention).
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    img.data.set(data.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
