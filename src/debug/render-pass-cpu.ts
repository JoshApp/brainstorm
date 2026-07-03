import type { DelveRenderer } from '../scene/create-renderer';
import { reportPassCpu, passCpuWanted } from './frame-timing';
import { isScenePassTarget } from '../style/render-webgpu';

// ── Per-pass CPU encode attribution ──────────────────────────────────────────
//
// The 2026-07-03 phone triage showed the frame's cost is CPU ENCODE inside
// renderWebGPU — but the recorder's 'render' line is one opaque number across
// all render passes (shadow map, scene, post chain, canvas blit). This wraps
// the backend's beginRender/finishRender — the exact brackets Three encodes a
// pass's draws between — and buckets the wall-clock per pass kind into the
// frame-timing systems map, so phone recordings split 'render' into
// 'render·shadow' / 'render·scene' / 'render·post' / 'render·canvas' rows.
//
// Passes NEST (the canvas quad's context opens first, and the scene pass —
// which itself triggers the shadow pass — renders inside it), so each bucket
// reports SELF time: its bracket minus its children's brackets. The buckets
// therefore sum to ≈ the 'render' system line instead of double-counting.
//
// Cost when idle: one boolean check per pass (~8/frame). Accumulation only
// happens while frame-timing has listeners (a recording or the profiler HUD),
// same policy as every other probe. Ships in prod like the rest of the
// profiler chain — recordings come from the live phone build.

interface RenderContextLike {
  renderTarget?: {
    depthTexture?: { name?: string } | null;
    texture?: { name?: string } | null;
  } | null;
}

function classify(ctx: RenderContextLike): string {
  const rt = ctx.renderTarget;
  if (!rt) return 'render·canvas';
  if (rt.depthTexture?.name === 'ShadowDepthTexture') return 'render·shadow';
  if (isScenePassTarget(rt)) return 'render·scene';
  return 'render·post';
}

interface Span { ctx: RenderContextLike; label: string; start: number; childMs: number }
const stack: Span[] = [];

let installed = false;

/** Patch the WebGPU backend's pass brackets. Idempotent; call once after the
 *  renderer has initialised (the backend must exist). */
export function installRenderPassCpu(renderer: DelveRenderer): void {
  if (installed) return;
  const backend = (renderer as unknown as {
    backend?: {
      beginRender?: (ctx: RenderContextLike) => unknown;
      finishRender?: (ctx: RenderContextLike) => unknown;
    };
  }).backend;
  if (!backend?.beginRender || !backend.finishRender) return;
  installed = true;

  const origBegin = backend.beginRender.bind(backend);
  const origFinish = backend.finishRender.bind(backend);
  backend.beginRender = (ctx: RenderContextLike) => {
    if (passCpuWanted()) stack.push({ ctx, label: classify(ctx), start: performance.now(), childMs: 0 });
    return origBegin(ctx);
  };
  backend.finishRender = (ctx: RenderContextLike) => {
    const r = origFinish(ctx);
    // Brackets are LIFO (nested function calls); if arming mid-frame left the
    // stack unbalanced, drop silently until it re-syncs next frame.
    const top = stack[stack.length - 1];
    if (top && top.ctx === ctx) {
      stack.pop();
      const total = performance.now() - top.start;
      reportPassCpu(top.label, Math.max(0, total - top.childMs));
      const parent = stack[stack.length - 1];
      if (parent) parent.childMs += total;
    }
    return r;
  };
}
