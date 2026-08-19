import * as THREE from 'three';
import { resetGoreWebGPU } from '../scene/gore-webgpu';
import './spawn-warmups';   // side-effect: registers enemy/item/destructible warmups
import { getWarmupHooks } from './warmup-registry';
import { warmRenderWebGPU, flushWarmRenders, setWarmLowRes } from '../style/render-webgpu';
import { beginLoading, endLoading } from '../scene/loading-gate';
import type { DelveRenderer } from '../scene/create-renderer';

// ── The unified warmup pass (WebGPU) ────────────────────────────────────────
//
// ONE place that compiles every render pipeline the game will use, run behind
// the load cover so first-use doesn't hitch. Three keys its pipeline cache on
// the live render state (material + target format + the global banded/fog model),
// so the warm subjects are built + compiled through the REAL PSX pipeline
// (warmRenderWebGPU) — the cache keys then match the live render exactly.

// Retained for the renderer's lifetime — these materials hold the compiled
// pipelines. A few dozen tiny JS objects mapping to the unique pipelines.
const retained: THREE.Material[] = [];
function retainMaterials(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) retained.push(mat);
  });
}
function noCull(obj: THREE.Object3D): void {
  obj.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
}

let done = false;

/** Run the unified warmup (WebGPU path). Same subjects, but the node renderer
 *  compiles a render PIPELINE per material/state via `compileAsync`.
 *
 *  The warm subjects are added to the LIVE scene and compiled together with the
 *  real floor in ONE `compileAsync(scene, camera)` — so the cache keys match the
 *  live render EXACTLY (light count, fog, banded define) AND scene-pool effects
 *  (blood/coins/wisps/shatter, which the hooks spawn into their own pools) are
 *  actually in the compile set. The earlier detached-group version compiled only
 *  the group, so those effects never warmed — they only flashed.
 *
 *  This DOES put the subjects + a frame of effects in the scene briefly, so it
 *  MUST run behind the load cover (the reveal is gated on the returned promise —
 *  see descent-fade `revealWhenReady` / the boot veil). Teardown removes the
 *  group from the scene and empties the effect pools but does NOT dispose the warm
 *  geometry (disposing it black-screened the WebGPU world — the backend is still
 *  tracking those buffers); the resident cost is a few dozen tiny meshes, and the
 *  retained materials hold the compiled pipelines.
 *
 *  Idempotent (shares the `done` guard with the WebGL path) and best-effort: a
 *  driver hiccup must not brick the load. */
/** Yield to the next frame so the main thread never hard-blocks (no "page
 *  unresponsive"). The compositor-driven loading cover keeps animating across it. */
const yieldFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => r()));

/** Run the unified warmup (WebGPU path), CHUNKED so the boot never freezes the tab.
 *
 *  The roster build (buildCreature/buildModel/CSG for every enemy + item + prop +
 *  effect) is the heavy SYNCHRONOUS cost — doing it in one call is what froze the
 *  whole tab ("page unresponsive"). Here we drain the warmup registry in small
 *  BATCHES, yielding to a frame between each, so the main thread breathes and the
 *  loading bar (onProgress) advances honestly. Then ONE compile through the real PSX
 *  pipeline (subjects sit in the live scene behind the black load cover, so nothing
 *  flashes; the main loop is gated via warmRenderWebGPU's `warmingUp`).
 *
 *  onProgress(0..1) drives the descent loading bar. Reveal is gated on this promise
 *  (revealWhenReady), so the roster is compiled before the first enemy can spawn.
 *  Idempotent + best-effort: a driver hiccup must not brick the load. */
export async function runWarmupPassWebGPU(
  renderer: DelveRenderer, scene: THREE.Scene, camera: THREE.Camera,
  onProgress?: (t: number) => void,
): Promise<void> {
  if (done) return;
  done = true;
  // OWN THE FRAME — the game loop skips entirely while we warm (scene/loading-gate.ts):
  // no sim, no audio, no render of our half-built subjects. The browser keeps painting
  // the DOM loading cover (compositor) across our rAF yields.
  beginLoading();
  // Warm frames present behind the opaque cover — render them tiny (format-
  // identical, size-collapsed) so each compile batch stops paying a full-res
  // raster of the whole scene. Restored in the finally, before the reveal.
  setWarmLowRes(true);
  const warmGroup = new THREE.Group();
  warmGroup.position.copy(camera.position);
  // EVERY registered hook warms here, behind the cover — hooks are cheap
  // (materials on dummies, not full builds), and the rule is: gameplay is
  // never the compile lane. (The old essential/deferred tier split + play-time
  // stream died 2026-07-05.)
  const hooks = getWarmupHooks();
  try {
    scene.add(warmGroup);
    // BUILD, TIME-SLICED. Each hook spawn (buildCreature/CSG/skinning) is heavy +
    // synchronous — you cannot split ONE, but you can stop ACCUMULATING them into a
    // long block. Spawn hooks until ~8ms of this frame is spent, then yield to rAF so
    // the browser breathes (the "frame-gate work, worst-case frame" rule). Build = 70%.
    const FRAME_BUDGET_MS = 8;
    let idx = 0;
    while (idx < hooks.length) {
      const start = performance.now();
      do {
        try { hooks[idx].spawn(warmGroup); } catch { /* one bad hook must not sink it */ }
        idx++;
      } while (idx < hooks.length && performance.now() - start < FRAME_BUDGET_MS);
      onProgress?.(Math.min(0.7, (idx / Math.max(1, hooks.length)) * 0.7));
      await yieldFrame();
    }
    noCull(warmGroup);
    retainMaterials(warmGroup);   // pin every program the drained instances compiled
    onProgress?.(0.72);
    await yieldFrame();
    // COMPILE IN SMALL BATCHES. Each pipeline compile is a ~55ms SYNCHRONOUS block; rendering
    // all ~180 in ONE pass is a ~10s HARD FREEZE of the whole browser. So make only a few
    // dummies visible at a time and render those — each pass compiles ~a few pipelines
    // (~150ms), then we yield so the browser breathes. Same total time, but a RESPONSIVE
    // loading screen (the veil animates, the bar moves) instead of a frozen tab. Compiles are
    // sync because Three's render path uses createRenderPipeline; compileAsync is worse here.
    // Hide the rest of the scene's DRAWABLES (floor, props) during the batched compile so each
    // pass renders ONLY the few visible dummies — cheap. But NEVER the lights: the node
    // renderer bakes the lighting context (indirect/ambient/shadow node structure) into every
    // pipeline's WGSL, so a warm with lights hidden compiles UNLIT variants — and the first
    // live draw of that material recompiles the lit one MID-PLAY (the compile-guard verdicts
    // read exactly "warm{indirect:0 ambient:0 shadow:0} vs live{indirect:10 ambient:3}"). The
    // old top-level children hide also swallowed the player group — taking the shadow-casting
    // LAMP out of the warm's world. Hiding leaf drawables (never lights, never light parents,
    // since visibility is hierarchical) keeps the lighting context identical to play.
    // Objects flagged userData.warmKeep (e.g. the GPU embers Points) stay visible too —
    // those must render during the warm so their pipeline compiles here.
    // Objects flagged userData.warmIgnore are skipped ENTIRELY (scene/warm-visibility.ts):
    // a pool's parked slots use `visible` as system state, not as a culling
    // decision, so snapshotting one mid-flight and restoring it later writes a
    // stale lifetime back into the pool's own bookkeeping.
    const others: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const any = o as THREE.Object3D & { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
      if (!(any.isMesh || any.isSprite || any.isPoints || any.isLine)) return;
      let p: THREE.Object3D | null = o;
      while (p) { if (p === warmGroup || p.userData.warmKeep || p.userData.warmIgnore) return; p = p.parent; }
      if (o.visible) others.push(o);
    });
    for (const c of others) c.visible = false;
    const kids = warmGroup.children.slice();
    for (const k of kids) k.visible = false;
    // 8 per render (was 3): with the floor's drawables hidden and the warm at
    // tiny resolution, the per-render cost is the COMPILES, not the raster —
    // bigger batches just mean fewer rAF yields between them.
    const CBATCH = 8;
    for (let i = 0; i < kids.length; i += CBATCH) {
      for (let j = i; j < Math.min(i + CBATCH, kids.length); j++) kids[j].visible = true;
      await warmRenderWebGPU(renderer, scene, camera, 1);
      onProgress?.(0.72 + 0.28 * Math.min(1, (i + CBATCH) / Math.max(1, kids.length)));
      await yieldFrame();
    }
    for (const k of kids) k.visible = true;
    for (const c of others) c.visible = true;
    onProgress?.(1);
  } catch { /* best-effort — a driver hiccup must not brick the load */ } finally {
    setWarmLowRes(false);
    try { await flushWarmRenders(renderer); } catch { /* best-effort */ }
    for (const h of hooks) { try { h.clear(); } catch { /* skip */ } }
    // The blood-burst warm-up stamps a gore splat into the per-fragment gore
    // buffer (a separate store from the effect pool h.clear() drops) — wipe it, or
    // you spawn into two warm-up bloodstains at your feet.
    resetGoreWebGPU();
    scene.remove(warmGroup);   // pipelines retained via materials; don't dispose geometry
    endLoading();   // game resumes — renders the ready world for the reveal fade
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass:webgpu] chunked warm done (${hooks.length} hooks); retained ${retained.length} materials.`);
  }
}
