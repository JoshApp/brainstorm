// FRAME CAPTURE — a tiny seam so the bug-report tool can grab the current game
// frame + camera without importing the renderer/scene/camera (which live in
// main's boot scope). main.ts registers a provider once; the report reads it.
//
// The provider forces a fresh render then reads the canvas as a PNG data URL —
// the same path the harness screenshot uses (a WebGPU canvas isn't guaranteed
// to retain its buffer after present, so we re-render immediately before the
// read). The game scene is rendered WITHOUT the DOM HUD/menus, so the shot is a
// clean view of the run.

export interface FrameContext {
  /** PNG data URL of the current frame, or null if the read failed. */
  png: string | null;
  /** Camera world position + yaw at capture time. */
  cameraPos: { x: number; y: number; z: number };
  yaw: number;
}

let provider: (() => FrameContext) | null = null;

/** Called once from main's boot with a closure over renderer/scene/camera/canvas. */
export function registerFrameCapture(fn: () => FrameContext): void {
  provider = fn;
}

/** Grab the current frame + camera, or null if no provider is registered yet. */
export function captureFrameContext(): FrameContext | null {
  if (!provider) return null;
  try {
    return provider();
  } catch {
    return null;
  }
}
