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

// ── METHODICAL DESCRIPTOR DIAGNOSTIC ──────────────────────────────────────────────────────────────
// For EVERY pipeline the GPU compiles, fingerprint its full descriptor (vertex layout + blend + depth +
// primitive + shader-module labels) — the GPU-level pipeline identity. Record what the WARM compiled
// (by material label); then for each IN-PLAY compile, say whether the warm produced that EXACT
// descriptor, and if not, the DIFF. Turns "X compiles" into "THIS descriptor isn't warmed; it differs
// from the warmed one in <field>". With a fixed replayed floor, drive the list to zero, no guessing.
interface PipeDesc { label: string; attrs: string; blend: string; depth: string; prim: string; targets: string; mod: string; }
const warmedByLabel = new Map<string, PipeDesc[]>();   // material label -> descriptors compiled during the warm
const liveCompiles: PipeDesc[] = [];                    // descriptors compiled in-play (post-warm)

// Shader-module code hash, captured by patching createShaderModule — so the descriptor fingerprint
// includes the SHADER identity (fog / flatShading / light-count variants live in the WGSL, not the GPU
// render state). A live compile whose render state matches a warmed one but whose shader-hash differs is
// a SHADER variant we warmed wrong, not a render-state miss — the verdict can then say which.
const moduleHash = new WeakMap<object, string>();
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function parseLabel(raw: string | undefined): string {
  const m = (raw ?? '').match(/^renderPipeline_(.+)_\d+$/);
  return m ? m[1] : (raw || '?');
}
function describePipeline(d: unknown): PipeDesc {
  const x = d as {
    label?: string;
    vertex?: { buffers?: Array<{ attributes?: Array<{ shaderLocation?: number; format?: string }> } | null>; module?: { label?: string } };
    fragment?: { targets?: Array<{ format?: string; blend?: { color?: { srcFactor?: string; dstFactor?: string }; alpha?: { srcFactor?: string; dstFactor?: string } } } | null>; module?: { label?: string } };
    depthStencil?: { depthWriteEnabled?: boolean; depthCompare?: string };
    primitive?: { topology?: string; cullMode?: string };
  };
  const attrs = (x.vertex?.buffers ?? [])
    .flatMap((b) => (b?.attributes ?? []).map((a) => `${a.shaderLocation}:${a.format}`)).sort().join(' ');
  const targets = (x.fragment?.targets ?? []).map((t) => t?.format ?? '?').join('+');
  const t0 = x.fragment?.targets?.[0];
  const blend = t0?.blend ? `${t0.blend.color?.srcFactor}>${t0.blend.color?.dstFactor}|a:${t0.blend.alpha?.srcFactor}>${t0.blend.alpha?.dstFactor}` : 'opaque';
  const ds = x.depthStencil;
  const depth = ds ? `w${ds.depthWriteEnabled ? 1 : 0}:${ds.depthCompare}` : 'none';
  const p = x.primitive ?? {};
  const prim = `${p.topology ?? '?'}/${p.cullMode ?? 'none'}`;
  const vm = x.vertex?.module as object | undefined;
  const fm = x.fragment?.module as object | undefined;
  const mod = `${(vm && moduleHash.get(vm)) ?? x.vertex?.module?.label ?? ''}|${(fm && moduleHash.get(fm)) ?? x.fragment?.module?.label ?? ''}`;
  return { label: parseLabel(x.label), attrs, blend, depth, prim, targets, mod };
}
function sigOf(d: PipeDesc): string { return `${d.attrs}|${d.blend}|${d.depth}|${d.prim}|${d.targets}|${d.mod}`; }
function diffDesc(live: PipeDesc, warm: PipeDesc): string {
  const out: string[] = [];
  if (live.attrs !== warm.attrs) out.push(`attrs live[${live.attrs}] vs warm[${warm.attrs}]`);
  if (live.blend !== warm.blend) out.push(`blend ${live.blend} vs ${warm.blend}`);
  if (live.depth !== warm.depth) out.push(`depth ${live.depth} vs ${warm.depth}`);
  if (live.prim !== warm.prim) out.push(`prim ${live.prim} vs ${warm.prim}`);
  if (live.targets !== warm.targets) out.push(`targets ${live.targets} vs ${warm.targets}`);
  if (!out.length && live.mod !== warm.mod) out.push('shader-module differs (fog / flatShading / light-count variant — not in render state)');
  return out.join('; ') || 'identical to a warmed descriptor (browser pipeline-cache miss)';
}

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
  // Capture each shader module's code hash so the descriptor fingerprint can see shader (fog/etc.) variants.
  const origSM = dev['createShaderModule'];
  if (typeof origSM === 'function') {
    const boundSM = origSM.bind(device);
    dev['createShaderModule'] = (...a: unknown[]) => {
      const mod = boundSM(...a);
      try {
        const code = (a[0] as { code?: string } | undefined)?.code;
        if (code && mod && typeof mod === 'object') moduleHash.set(mod, hashStr(code));
      } catch { /* never break module creation */ }
      return mod;
    };
  }
  for (const method of ['createRenderPipelineAsync', 'createRenderPipeline'] as const) {
    const orig = dev[method];
    if (typeof orig !== 'function') continue;
    const bound = orig.bind(device);
    dev[method] = (...args: unknown[]) => {
      try {
        total++;
        const desc = describePipeline(args[0]);
        if (isWarmingUp()) {
          // Compiles while a warm pass runs (boot warm + descent warmSceneCompile + warmRealRoster) are
          // the REFERENCE set: record each descriptor by material label so we can later tell whether an
          // in-play compile matches something we warmed, and if not, exactly how it differs.
          const arr = warmedByLabel.get(desc.label) ?? [];
          if (arr.length < 64 && !arr.some((w) => sigOf(w) === sigOf(desc))) arr.push(desc);
          warmedByLabel.set(desc.label, arr);
        } else if (warmupDone) {
          // Live play after warmup = a felt hitch (a warm gap).
          postWarmup++;
          liveCompiles.push(desc);
          if (postWarmupLabels.length < 1000) postWarmupLabels.push(`${desc.label}||${desc.attrs.split(' ').filter(Boolean).length}`);
          // eslint-disable-next-line no-console
          console.warn(`[warmup-guard:webgpu] IN-PLAY compile #${postWarmup} — '${desc.label}' [${desc.blend} ${desc.depth}]. Run __compileReport() for the per-descriptor verdict.`);
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

/** Methodical, pasteable verdict on what compiled IN-PLAY and WHY the warm missed it. For each distinct
 *  in-play pipeline descriptor: its material, how many times it hit, and a VERDICT —
 *   - NOT-WARMED          → the warm never compiled this material at all (coverage gap: warm it).
 *   - MISMATCH: <diff>    → the warm compiled this material but with a DIFFERENT descriptor; the diff
 *                           names the field (blend / depth / attrs / shader-module=fog) — fix the warm
 *                           to produce THIS descriptor.
 *   - CACHE-MISS          → byte-identical to a warmed descriptor yet recompiled (browser cache only).
 *  Replay a fixed floor and drive `problems` to []. */
export function webgpuCompileReport(): {
  total: number; postWarmup: number;
  problems: Array<{ material: string; count: number; layout: string; state: string; verdict: string }>;
} {
  const groups = new Map<string, { desc: PipeDesc; count: number }>();
  for (const d of liveCompiles) {
    const key = `${d.label}|${sigOf(d)}`;
    const g = groups.get(key) ?? { desc: d, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  const problems = [...groups.values()].map(({ desc, count }) => {
    const warm = warmedByLabel.get(desc.label);
    let verdict: string;
    if (!warm || warm.length === 0) {
      verdict = 'NOT-WARMED — material never compiled during the warm';
    } else if (warm.some((w) => sigOf(w) === sigOf(desc))) {
      verdict = 'CACHE-MISS — identical descriptor was warmed but recompiled (browser pipeline cache)';
    } else {
      // Diff against the warmed variant that shares the most fields (the nearest miss).
      const score = (w: PipeDesc): number =>
        (w.attrs === desc.attrs ? 1 : 0) + (w.blend === desc.blend ? 1 : 0) + (w.depth === desc.depth ? 1 : 0) + (w.prim === desc.prim ? 1 : 0);
      const nearest = warm.reduce((best, w) => (score(w) > score(best) ? w : best), warm[0]);
      verdict = `MISMATCH — ${diffDesc(desc, nearest)}`;
    }
    return { material: desc.label, count, layout: desc.attrs || '(none)', state: `${desc.blend} ${desc.depth} ${desc.prim}`, verdict };
  });
  problems.sort((a, b) => b.count - a.count);
  return { total, postWarmup, problems };
}
