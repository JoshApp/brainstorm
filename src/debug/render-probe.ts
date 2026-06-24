// Neutral seam between the PSX render pipeline (style/render-target.ts) and the
// profiler. render-target reports its sub-phase CPU times here (so the opaque
// "render: 11ms" blob splits into prepass / scene / bloom / blit) and, when the
// GPU probe is armed, a gl.finish()-measured GPU time per sampled frame.
//
// It's a leaf module with no deps so render-target can depend on it without
// pulling in the profiler. The profiler reaches IN to install the sinks; when
// nothing's installed every call here is a cheap nullable check, so it's free
// for players.

import { profSpansOn } from './prof-span';

type PhaseSink = (name: string, ms: number) => void;

let phaseSink: PhaseSink | null = null;
let gpuProbe = false;

/** Profiler installs (or clears) the sub-phase sink. */
export function installRenderProbe(phase: PhaseSink | null): void {
  phaseSink = phase;
}

/** Arm/disarm the GPU probe flag. The actual readback runs in frame-timing's
 *  frameEnd (so its stall is excluded from the frame timing); render-target
 *  doesn't touch it — this flag just records the user's intent. */
export function setRenderGpuProbe(on: boolean): void { gpuProbe = on; }
export function renderGpuProbeOn(): boolean { return gpuProbe; }

/** True when sub-phase timing is wanted — render-target gates its
 *  performance.now() calls on this so it's free when nobody's listening. */
export function renderProbeActive(): boolean { return phaseSink !== null; }

export function reportRenderPhase(name: string, ms: number): void {
  phaseSink?.(name, ms);
  // Mirror the sub-phase as a native User-Timing span so it nests under the
  // 'render' system bar in a DevTools recording. render-target hands us a
  // duration, not endpoints, so we anchor the span to end "now" — exact length,
  // and it still lands inside the render system's [t0,t1] window for nesting.
  if (profSpansOn()) {
    const end = performance.now();
    performance.measure(name, { start: end - ms, end });
  }
}

// ── Per-pass GPU spans ────────────────────────────────────────────────
// frame-timing installs these when per-pass GPU timing is on; render-target
// brackets each render pass (prepass / scene / bloom / blit) with them. The
// implementation (timer-query spans vs readPixels sync probe) lives entirely
// on the frame-timing side — this stays a dependency-free seam.

export interface GpuPassHooks {
  begin(label: string): void;
  end(): void;
}

let gpuPassHooks: GpuPassHooks | null = null;

export function installGpuPassHooks(h: GpuPassHooks | null): void { gpuPassHooks = h; }
export function gpuPassActive(): boolean { return gpuPassHooks !== null; }
export function gpuPassBegin(label: string): void { gpuPassHooks?.begin(label); }
export function gpuPassEnd(): void { gpuPassHooks?.end(); }
