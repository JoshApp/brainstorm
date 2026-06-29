import { DEV } from './dev';
import { isWarmingUp } from '../style/render-webgpu';

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
export function webgpuCompileStats(): { total: number; postWarmup: number; gaps: string[]; compileHitches: number; laggyFrames: number } {
  return { total, postWarmup, gaps: postWarmupLabels.slice(), compileHitches, laggyFrames };
}

// ── GAMEPLAY COMPILE / LAGSPIKE WATCH ────────────────────────────────────────
// Surfaces hitches AS THEY HAPPEN so they're catchable when content is added: every
// frame, if a new pipeline compiled in-play (a warm gap → the actionable kind) OR the
// frame just ran long (GC/CPU), it FLASHES a small on-screen banner. Silent otherwise.
// The goal is to make warm gaps impossible to miss: add a new effect, see it hitch,
// add its warmable. Counts are in window.__compileStats().
const SPIKE_MS = 32;          // >~2 frames at 60fps = a felt hitch
let compileHitches = 0;
let laggyFrames = 0;
let watchTotal = 0;
let watchAt = 0;
let banner: HTMLDivElement | null = null;

function ensureBanner(): HTMLDivElement {
  if (banner) return banner;
  banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '9999', pointerEvents: 'none', padding: '3px 10px', borderRadius: '4px',
    font: '600 11px ui-monospace, monospace', color: '#fff', letterSpacing: '0.04em',
    opacity: '0', transition: 'opacity 0.25s ease',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(banner);
  return banner;
}

/** Call once per frame (DEV). Flashes a banner on a compile-caused hitch (red — the
 *  fixable kind) or a non-compile lag frame (amber — GC/CPU). */
export function tickCompileWatch(): void {
  if (!DEV) return;
  const now = performance.now();
  const frameMs = watchAt ? now - watchAt : 16;
  watchAt = now;
  // Track postWarmup (felt, warm-aware) not total — so the banner flashes only on LIVE-play
  // compiles, not the deliberate behind-cover warm.
  const newCompiles = postWarmup - watchTotal;
  watchTotal = postWarmup;
  const compiled = newCompiles > 0;
  const laggy = frameMs > SPIKE_MS;
  if (compiled) compileHitches += newCompiles;
  if (laggy) laggyFrames++;
  if (!compiled && !laggy) { if (banner) banner.style.opacity = '0'; return; }
  const el = ensureBanner();
  if (compiled) {
    el.textContent = `⚠ COMPILE HITCH ×${newCompiles} · ${Math.round(frameMs)}ms · WARM GAP — __compileStats().gaps`;
    el.style.background = 'rgba(170,28,20,0.9)';
  } else {
    el.textContent = `lag ${Math.round(frameMs)}ms · no compile (GC/CPU)`;
    el.style.background = 'rgba(150,95,20,0.8)';
  }
  el.style.opacity = '1';
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
        // Only compiles during LIVE play are felt hitches. Compiles while a warm pass is running
        // (boot warm, or the descent warmSceneCompile — both set warmingUp) happen behind the load
        // cover and are EXPECTED, so don't count or warn on them. This makes postWarmup / the report
        // reflect the actual problem set, not the deliberate warm.
        if (warmupDone && !isWarmingUp()) {
          postWarmup++;
          const label = (args[0] as { label?: string } | undefined)?.label ?? '?';
          if (postWarmupLabels.length < 1000) postWarmupLabels.push(label);
          // eslint-disable-next-line no-console
          console.warn(`[warmup-guard:webgpu] pipeline #${postWarmup} compiled IN-PLAY — '${label}'. A warm gap; run __compileReport() for the compact summary.`);
        }
      } catch { /* bookkeeping must never break the renderer */ }
      return bound(...args);
    };
  }
  // Expose live stats for the perf overlay / manual checks.
  if (typeof window !== 'undefined') {
    (window as unknown as { __compileStats?: () => unknown }).__compileStats = () => webgpuCompileStats();
    (window as unknown as { __compileReport?: () => unknown }).__compileReport = () => webgpuCompileReport();
  }
}

/** Compact, pasteable summary of what compiled IN-PLAY, grouped by SOURCE and sorted by count.
 *  The pipeline label is `renderPipeline_${material.name || material.type}_${id}` (three.js
 *  WebGPUPipelineUtils), so naming a material (e.g. mat.name='effect:blood') makes it show up here
 *  by name instead of just 'MeshStandardMaterial'. Paste the output and it says exactly what's
 *  still compiling during play. */
export function webgpuCompileReport(): { total: number; postWarmup: number; bySource: Record<string, number> } {
  const bySource: Record<string, number> = {};
  for (const label of postWarmupLabels) {
    const m = label.match(/^renderPipeline_(.+)_\d+$/);
    const key = m ? m[1] : label;
    bySource[key] = (bySource[key] || 0) + 1;
  }
  const sorted = Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1]));
  return { total, postWarmup, bySource: sorted };
}
