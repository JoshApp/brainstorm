import * as THREE from 'three';
import { resetGoreWebGPU } from '../scene/gore-webgpu';
import './spawn-warmups';   // side-effect: registers enemy/item/destructible warmups
import { essentialWarmupHooks } from './warmup-registry';
import { warmRenderWebGPU } from '../style/render-webgpu';
import { beginLoading, endLoading } from '../scene/loading-gate';

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
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  onProgress?: (t: number) => void,
): Promise<void> {
  if (done) return;
  done = true;
  // OWN THE FRAME — the game loop skips entirely while we warm (scene/loading-gate.ts):
  // no sim, no audio, no render of our half-built subjects. The browser keeps painting
  // the DOM loading cover (compositor) across our rAF yields.
  beginLoading();
  const warmGroup = new THREE.Group();
  warmGroup.position.copy(camera.position);
  // Boot warms ONLY the cheap ESSENTIAL hooks (core combat VFX) — fast. The heavy
  // roster (enemies/items/destructibles) STREAMS during play (scene/warmup-stream.ts),
  // so it no longer blocks the descent.
  const hooks = essentialWarmupHooks();
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
    // Hide the rest of the scene (floor, props, lights) during the batched compile so each
    // pass renders ONLY the few visible dummies — cheap. (The pipeline is keyed on material +
    // format + the GLOBAL banded model + fog, not the specific lights, so a near-empty scene
    // compiles the same pipeline. The floor's own materials already compiled when the title
    // rendered before this.)
    // Hide the rest of the scene EXCEPT objects flagged userData.warmKeep (e.g. the GPU
    // embers Points) — those must render during the warm so their pipeline compiles here.
    const others = scene.children.filter((c) => c !== warmGroup && !c.userData.warmKeep);
    const prevVis = others.map((c) => c.visible);
    for (const c of others) c.visible = false;
    const kids = warmGroup.children.slice();
    for (const k of kids) k.visible = false;
    const CBATCH = 3;
    for (let i = 0; i < kids.length; i += CBATCH) {
      for (let j = i; j < Math.min(i + CBATCH, kids.length); j++) kids[j].visible = true;
      await warmRenderWebGPU(renderer, scene, camera, 1);
      onProgress?.(0.72 + 0.28 * Math.min(1, (i + CBATCH) / Math.max(1, kids.length)));
      await yieldFrame();
    }
    for (const k of kids) k.visible = true;
    others.forEach((c, i) => { c.visible = prevVis[i]; });
    onProgress?.(1);
  } catch { /* best-effort — a driver hiccup must not brick the load */ } finally {
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
