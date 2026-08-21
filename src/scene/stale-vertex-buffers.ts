import type { DelveRenderer } from './create-renderer';

// ── STALE VERTEX BUFFERS AFTER A GEOMETRY SWAP (three r185) ──────────────────
//
// THE BUG. `RenderObject` memoises two things that must agree: the resolved
// attribute list and the vertex-buffer list built from it.
//
//   getAttributes()      → sets this.attributes, this.attributesId, this.vertexBuffers
//   getVertexBuffers()   → if ( this.vertexBuffers === null ) this.getAttributes();
//
// When an object's geometry is exchanged in place, `RenderObjects.get` calls
// `renderObject.setGeometry( object.geometry )` (RenderObjects.js:123). That
// method clears TWO of the three:
//
//   setGeometry( geometry ) {
//     this.geometry = geometry;
//     this.attributes = null;
//     this.attributesId = null;      // <-- this.vertexBuffers is NOT cleared
//   }
//
// so `getVertexBuffers()` sees a non-null cache and hands back the buffers of
// the PREVIOUS geometry. `onGeometryDispose` has the same omission.
//
// Usually invisible, because the next thing that happens is a pipeline rebuild,
// and `createShaderVertexBuffers` calls `getAttributes()` — which repairs all
// three. The failure needs the pipeline lookup to HIT instead: `needsGeometryUpdate`
// fired (geometry id changed, or an attribute was re-uploaded with a new id) but
// `_needsRenderUpdate` did not, so nothing recomputes the attributes, and
// `WebGPUBackend.draw` binds the old buffer list against a pipeline built for the
// new layout:
//
//   Vertex buffer slot 0 required by [RenderPipeline "renderPipeline_modeldef:opa:plain_507"]
//   was not set. While encoding [RenderPassEncoder].DrawIndexed(36, 1, 0, 0, 0).
//
// Observed on main @443dd437 on every floor, once per frame, from ~30s in — and
// present long before the stable-buffer-names work, which is what it was first
// (wrongly) attributed to. Dawn reports it and drops the draw, so the symptom is
// an object that silently stops rendering plus a per-frame validation error.
//
// THE FIX is upstream's missing line: invalidate the vertex-buffer cache
// whenever the attribute cache is invalidated. We apply it at the last moment
// before use — `attributes === null` is exactly the state `setGeometry` leaves
// behind, and `getVertexBuffers()` rebuilds both from scratch.
//
// Instance-patched on the backend, never three's prototypes (same shape as
// bundle-pass-order.ts / stable-buffer-names.ts). `?stalevb=0` disables it.
//
// REMOVE ON A THREE BUMP IF `setGeometry` learns to null `vertexBuffers`
// (mrdoob/three.js — RenderObject.setGeometry + onGeometryDispose).

/* eslint-disable @typescript-eslint/no-explicit-any */

let installed = false;
let repaired = 0;

/** How many draws were saved from a stale vertex-buffer list this session.
 *  Non-zero is expected — it is the bug being caught, not a fault. */
export function staleVertexBufferRepairs(): number { return repaired; }

/** Install on the live renderer right after `init()`. Idempotent. */
export function installStaleVertexBufferFix(renderer: DelveRenderer): void {
  const backend = (renderer as any).backend;
  if (!backend || installed) return;
  if (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('stalevb') === '0') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[stale-vertex-buffers] disabled by ?stalevb=0');
    }
    return;
  }
  if (typeof backend.draw !== 'function') {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[stale-vertex-buffers] backend.draw missing — fix NOT installed');
    }
    return;
  }

  const origDraw = backend.draw.bind(backend);
  backend.draw = (renderObject: any, info: unknown): unknown => {
    // `attributes === null` with `vertexBuffers !== null` is unreachable except
    // through setGeometry/onGeometryDispose — so this is the omission, not a
    // guess about one.
    if (renderObject.attributes === null && renderObject.vertexBuffers !== null) {
      renderObject.vertexBuffers = null;
      repaired++;
    }
    return origDraw(renderObject, info);
  };

  installed = true;
  if (typeof window !== 'undefined') {
    (window as unknown as { __staleVertexBuffers?: () => number })
      .__staleVertexBuffers = staleVertexBufferRepairs;
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[stale-vertex-buffers] geometry-swap cache repair installed');
  }
}
