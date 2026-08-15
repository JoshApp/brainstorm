import type { DelveRenderer } from '../scene/create-renderer';
import { reportPassCpu, passCpuWanted } from './frame-timing';

// ── WHAT IS THE 7.2ms OF render·scene MADE OF? ───────────────────────────────
//
// render-pass-cpu.ts splits the frame's `render` line into shadow / scene /
// post / canvas, and on a phone `render·scene` came back at 7.2ms of a 9.7ms
// frame. That is where the game's CPU goes, and it has been one opaque number
// ever since. The upload hunt that preceded this was, in hindsight, an attempt
// to guess its composition from a side channel — 44% of GPU uploads turned out
// to be pure waste and fixing them moved the frame by 0.2ms, because uploads
// correlated with the same thing the encode did (drawn objects) without being
// what cost the time.
//
// So measure it directly. Three encodes each object through
// Renderer._renderObjectDirect, which is a fixed sequence of manager calls:
//
//   this._objects.get(...)            resolve/create the RenderObject
//   this._nodes.needsRefresh(...)     has its node state changed
//   this._nodes.updateBefore/For(...) run node updates
//   this._bindings.updateForRender()  push uniforms (the upload path)
//   this._pipelines.updateForRender() resolve the pipeline
//   this.backend.draw(...)            encode the draw
//
// Every one of those is a method on an instance hanging off the renderer, so
// they can be wrapped without touching three. Each bucket accumulates SELF time
// and reports into the same systems map the passes use, so a phone recording
// grows `enc·objects` / `enc·nodes` / `enc·bindings` / `enc·pipelines` /
// `enc·draw` rows next to `render·scene` and they sum to roughly it.
//
// Cost when nobody is listening: one boolean per wrapped call. Accumulation only
// while frame-timing has listeners, same policy as the other probes. Ships in
// prod — recordings come from the live phone build, and a DEV gate would put
// this out of reach of the only device that shows the problem.

/* eslint-disable @typescript-eslint/no-explicit-any */

let installed = false;
const buckets = new Map<string, number>();

/**
 * Wrap `obj[key]`, accumulating wall-clock into `label`.
 *
 * `outermostOnly` is for RECURSIVE methods. _projectObject walks the scene by
 * calling itself, so timing every entry counts each level again inside its
 * parent's span and reports a number several times the truth. A depth counter
 * charges only the top-level call, which is the one that means "the whole
 * render-list build".
 */
function wrap(obj: any, key: string, label: string, outermostOnly = false): void {
  const orig = obj?.[key];
  if (typeof orig !== 'function') return;
  let depth = 0;
  obj[key] = function (this: unknown, ...args: unknown[]): unknown {
    if (!passCpuWanted()) return orig.apply(this, args);
    if (outermostOnly && depth > 0) { depth++; try { return orig.apply(this, args); } finally { depth--; } }
    depth++;
    const t0 = performance.now();
    try {
      return orig.apply(this, args);
    } finally {
      depth--;
      buckets.set(label, (buckets.get(label) ?? 0) + (performance.now() - t0));
    }
  };
}

/**
 * Wrap the per-object encode managers. Call once at boot, after the renderer
 * exists (alongside installRenderPassCpu).
 *
 * NOTE these nest inside `render·scene`, so their rows are ADDITIONAL to it,
 * not a subdivision the recorder subtracts — read them against `render·scene`,
 * not summed with the other systems.
 */
export function installEncodeBreakdown(renderer: DelveRenderer): void {
  if (installed) return;
  const r = renderer as any;
  if (!r._objects || !r._bindings || !r._pipelines) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[encode-breakdown] NOT installed — managers missing:',
        Object.keys(r).filter((k) => k.startsWith('_')).slice(0, 20).join(','));
    }
    return;
  }
  installed = true;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[encode-breakdown] installed');
  }
  wrap(r._objects, 'get', 'enc·objects');
  wrap(r._bindings, 'updateForRender', 'enc·bindings');
  wrap(r._pipelines, 'updateForRender', 'enc·pipelines');
  wrap(r._pipelines, 'isReady', 'enc·pipelineReady');
  wrap(r._nodes, 'needsRefresh', 'enc·nodesCheck');
  wrap(r._nodes, 'updateForRender', 'enc·nodesUpdate');
  wrap(r._nodes, 'updateBefore', 'enc·nodesBefore');
  wrap(r._geometries, 'updateForRender', 'enc·geometry');
  wrap(r.backend, 'draw', 'enc·draw');
  // The render-list build — culling and sorting every object in the scene,
  // which is per-SCENE-object work rather than per-drawn-object and so scales
  // with a different number than everything above.
  wrap(r, '_projectObject', 'enc·project', true);
}

/** Flush this frame's buckets into the systems map. Call once per frame, after
 *  the render, before frame-timing samples. */
export function flushEncodeBreakdown(): void {
  if (buckets.size === 0) return;
  for (const [label, ms] of buckets) reportPassCpu(label, ms);
  buckets.clear();
}
