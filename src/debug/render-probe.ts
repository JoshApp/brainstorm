// Neutral seam between the PSX render pipeline (style/render-target.ts) and the
// profiler. render-target reports its sub-phase CPU times here (so the opaque
// "render: 11ms" blob splits into prepass / scene / bloom / blit) and, when the
// GPU probe is armed, a gl.finish()-measured GPU time per sampled frame.
//
// It's a leaf module with no deps so render-target can depend on it without
// pulling in the profiler. The profiler reaches IN to install the sinks; when
// nothing's installed every call here is a cheap nullable check, so it's free
// for players.

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

export function reportRenderPhase(name: string, ms: number): void { phaseSink?.(name, ms); }
