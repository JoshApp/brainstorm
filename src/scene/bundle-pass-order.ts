import type * as THREE from 'three';
import type { DelveRenderer } from './create-renderer';

// ── RENDER-BUNDLE PASS-ORDER FIX (three r185) ────────────────────────────────
//
// Upstream three executes recorded render bundles at the END of the render
// pass: `WebGPUBackend.finishRender` calls `executeBundles` after every
// regular draw has been encoded (WebGPUBackend.js:990). That means bundled
// OPAQUE geometry draws AFTER the scene's transparents. Our flames are
// additive sprites with depthWrite=false — they encode fine, then the bundle
// replays the opaque wall/bonfire-mound BEHIND them, which passes the depth
// test (the sprite wrote no depth) and overwrites those pixels. This was
// "strike 3" in render-bundles.ts: fires visibly gone, zero validation
// errors, instances alive — because they rendered and were then painted over.
//
// The fix: flush the pass's pending bundles into the command stream after
// the opaques and BEFORE the transparents are encoded — the position bundled
// static geometry actually belongs in. Two backend details make this safe:
//
//  - `executeBundles` resets the pass's pipeline/bind-group/vertex-buffer
//    state, and the backend caches those in `renderContextData.currentSets`
//    to skip redundant re-binds — so the flush must also reset that cache
//    (same shape `beginBundle` uses) or the next regular draw would encode
//    against state WebGPU just cleared.
//  - `_renderTransparents` runs in three contexts: the main pass (flush
//    here), bundle RECORDING (`_currentRenderBundle` set, currentPass is a
//    bundle encoder — must skip), and `compileAsync` (no active pass at all —
//    must skip). We arm the flush in `beginRender` (which also resets the
//    pass's bundle list) and disarm on flush, so only a live pass qualifies.
//
// `finishRender`'s own executeBundles is length-guarded, so draining the
// array here cleanly disables the late path. WebGL2 backend records no
// bundles (renderList.bundles stays empty without backend.beginBundle), so
// the wrapper no-ops there. Remove on a three bump IF upstream moves bundle
// execution into draw order — verify with: title screen, ?bundles=1 (or
// default ON), bonfire flame visible.

interface PassData {
  renderBundles?: unknown[];
  currentPass?: { executeBundles?: (bundles: unknown[]) => void };
  currentSets?: unknown;
  bundleFlushArmed?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The camera the MAIN scene pass renders with. Bundles are only projected /
 *  recorded / executed for this camera — every other pass (lamp shadow map,
 *  cube-shadow depth-array layers, any render-to-texture helper) skips the
 *  bundle path entirely and renders bundle members as plain objects instead.
 *  Two reasons this gate is load-bearing:
 *   - depth-array shadow passes have NO render pass encoder (`currentPass` is
 *     null / a per-layer BUNDLE encoder, which has no executeBundles) — the
 *     upstream late-execute path AND our flush both crash there. This was the
 *     black-screen-after-descent: a cube-shadow light + a bundle in view.
 *   - shadow passes would otherwise re-record every bundle per shadow camera
 *     (bundle cache is keyed on camera), pure waste for statics that mostly
 *     don't cast.
 */
let mainPassCamera: THREE.Camera | null = null;
export function setBundleMainCamera(camera: THREE.Camera): void { mainPassCamera = camera; }

/** Install on the live renderer right after `init()`. Patches the instance
 *  (renderer + backend), not three's prototypes. */
export function installBundlePassOrderFix(renderer: DelveRenderer): void {
  const r = renderer as any;
  const backend = r.backend;
  if (!backend?.isWebGPUBackend) return;   // WebGL2 fallback: no bundle support
  if (typeof r._renderTransparents !== 'function' || typeof r._renderBundles !== 'function'
      || typeof backend.beginRender !== 'function') {
    // A three bump renamed the seams — bundles fall back to upstream's
    // (broken-order) path rather than crash. The render-bundles module's
    // verify note covers catching this visually.
    if (import.meta.env.DEV) console.warn('[bundle-pass-order] renderer seams missing — fix NOT installed');
    return;
  }

  // GATE: only the main pass records + executes bundles. In every other pass
  // the bundle groups' children were still projected into the bundle's OWN
  // list (not the pass's), so skipping _renderBundles there means those
  // statics simply don't draw into shadow maps — correct for our cast-off
  // shells/props, and render-bundles.ts keeps cast-ON subtrees out of bundles.
  const origRenderBundles = r._renderBundles;
  r._renderBundles = function (bundles: unknown[], sceneRef: unknown, lightsNode: unknown) {
    const cam = this._currentRenderContext?.camera;
    if (mainPassCamera !== null && cam !== mainPassCamera) return;   // skip: not the main pass
    return origRenderBundles.call(this, bundles, sceneRef, lightsNode);
  };

  const origBeginRender = backend.beginRender.bind(backend);
  backend.beginRender = (renderContext: unknown) => {
    origBeginRender(renderContext);
    // beginRender just reset this pass's bundle list — arm the mid-pass flush.
    (backend.get(renderContext) as PassData).bundleFlushArmed = true;
  };

  const origRenderTransparents = r._renderTransparents;
  r._renderTransparents = function (...args: unknown[]) {
    if (this._currentRenderBundle === null && this._currentRenderContext) {
      const data = backend.get(this._currentRenderContext) as PassData;
      // typeof-guard: in depth-array passes currentPass is null or a bundle
      // ENCODER — executeBundles only exists on a real render pass encoder.
      if (data.bundleFlushArmed && data.renderBundles && data.renderBundles.length > 0
          && typeof data.currentPass?.executeBundles === 'function') {
        data.currentPass.executeBundles(data.renderBundles);
        data.renderBundles.length = 0;   // finishRender's late path is length-guarded off
        // executeBundles cleared the pass state — drop the binding cache so
        // the next draw re-binds everything (shape mirrors beginBundle's).
        data.currentSets = { attributes: {}, bindingGroups: [], pipeline: null, index: null };
      }
      data.bundleFlushArmed = false;
    }
    return origRenderTransparents.apply(this, args);
  };

  if (import.meta.env.DEV) console.log('[bundle-pass-order] mid-pass bundle flush installed');
}
