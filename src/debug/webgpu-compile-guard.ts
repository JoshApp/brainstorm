import { DEV } from './dev';

// ── WEBGPU COMPILE GUARD ─────────────────────────────────────────────────────
//
// The WebGL self-policing guard (frame-timing.ts markWarmupComplete) reads
// renderer.info.programs — which WebGPURenderer does NOT populate. So on WebGPU we
// had NO way to see whether a pipeline compiled DURING PLAY (a warm gap → a hitch).
//
// This monkey-patches the GPUDevice's pipeline creation so every compile is counted,
// and once warmup is marked complete, any new compile WARNS (DEV) — the WebGPU-native
// version of the "record what the game actually compiles" instrument. It's how we
// validate that the cheap materials-on-dummies warm (spawn-warmups.ts) really covers
// the live roster: if nothing compiles after warmup, the warm is comprehensive; if
// something does, the warning names it and we add a warmable.
//
// DEV-only (the patch is gated + this whole module dead-code-eliminates in prod).

let warmupDone = false;
let total = 0;
let postWarmup = 0;
const postWarmupLabels: string[] = [];

/** Arm the guard — call when the warmup finishes. */
export function markWebGPUWarmupComplete(): void { warmupDone = true; }

/** Diagnostics: total pipelines compiled, and how many AFTER warmup (the gaps). */
export function webgpuCompileStats(): { total: number; postWarmup: number; gaps: string[] } {
  return { total, postWarmup, gaps: postWarmupLabels.slice() };
}

/** Patch a GPUDevice's render+compute pipeline creation to count compiles and warn on
 *  post-warmup ones. Idempotent (guards against double-patching). Pass renderer.backend.device
 *  after the WebGPU renderer has initialised. */
export function installWebGPUCompileGuard(device: unknown): void {
  if (!DEV || !device || (device as unknown as { __delveGuard?: boolean }).__delveGuard) return;
  (device as unknown as { __delveGuard?: boolean }).__delveGuard = true;
  // Only patch the ASYNC render-pipeline path (what WebGPURenderer uses to compile).
  // The wrapper passes ALL args through unchanged and does its bookkeeping inside a
  // try/catch, so it can NEVER alter or break the real pipeline creation.
  const dev = device as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>;
  for (const method of ['createRenderPipelineAsync', 'createRenderPipeline'] as const) {
    const orig = dev[method];
    if (typeof orig !== 'function') continue;
    const bound = orig.bind(device);
    dev[method] = (...args: unknown[]) => {
      try {
        total++;
        if (warmupDone) {
          postWarmup++;
          const label = (args[0] as { label?: string } | undefined)?.label ?? '?';
          if (postWarmupLabels.length < 60) postWarmupLabels.push(label);
          // eslint-disable-next-line no-console
          console.warn(`[warmup-guard:webgpu] pipeline #${postWarmup} compiled IN-PLAY — '${label}'. A warm gap; add a warmable (content/spawn-warmups.ts).`);
        }
      } catch { /* bookkeeping must never break the renderer */ }
      return bound(...args);
    };
  }
  // Expose live stats for the perf overlay / manual checks.
  if (typeof window !== 'undefined') {
    (window as unknown as { __compileStats?: () => unknown }).__compileStats = () => webgpuCompileStats();
  }
}
