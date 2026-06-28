import * as THREE from 'three';
import './spawn-warmups';   // side-effect: registers enemy/item/destructible warmups
import { getWarmupHooks, essentialWarmupHooks } from './warmup-registry';
import { warmRenderWebGPU } from '../style/render-webgpu';
import { beginLoading, endLoading } from '../scene/loading-gate';

// ── The unified warmup pass ─────────────────────────────────────────────────
//
// ONE place that compiles every shader program the game will use, run ONCE at
// the first level load. It replaces the scattered warm paths (boot scratch-scene
// render, precompileRosterInScene, the instanced-warm hack, the gore stamp warm)
// that each warmed a slice in a slightly different — and often WRONG — way.
//
// Two root causes the patchwork kept tripping on, fixed here by construction:
//
//  1. WRONG CONTEXT. Three keys its shader-program cache on the live render
//     state — point-light COUNT, fog, the banded-lighting define, whether the
//     object is instanced, whether the shadow pass runs. The old boot warm used
//     a 1-light scratch scene, so its programs never matched the live ~11-light
//     scene and the first real draw recompiled. This pass renders in the LIVE
//     scene + camera, so the cache keys match exactly.
//
//  2. DISPOSE DELETES THE PROGRAM. WebGL deletes a program when its last
//     referencing material is disposed — so every prior warm that built →
//     rendered → DISPOSED actually threw its compiled programs away (it only
//     JIT'd code + warmed the geometry pool). This pass RETAINS its materials
//     (never disposes them) so the programs survive; it disposes only the
//     geometry + meshes (the resident GPU cost). Instanced batches keep their
//     program via the segmentCache material and shed only the parked-instance
//     buffers (see disposeEmptyBatches).
//
// Render the whole live scene once into a tiny offscreen target with shadows
// forced on; frustumCulled is forced false on every warm subject so nothing is
// culled out of the compile.

// Retained for the renderer's lifetime — these materials hold the compiled
// programs. A few dozen tiny JS objects mapping to ~a dozen unique programs.
const retained: THREE.Material[] = [];
function retainMaterials(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) retained.push(mat);
  });
}
function disposeGeometry(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g && g.userData.pooled !== true) g.dispose();   // pooled geo is shared — leave it
  });
}
function noCull(obj: THREE.Object3D): void {
  obj.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
}

let done = false;

/** Build every warm subject — enemies (skinned + non-skinned chunk variant),
 *  item drop models, effect pools — into one group parented at the camera and
 *  added to the live scene. Returns the group + the effect hooks so the caller
 *  can compile, then tear down. Shared by the WebGL (render-to-target) and WebGPU
 *  (compileAsync) finishers; per-subject try/catch so one bad spec can't sink it. */
function buildWarmSubjects(
  camera: THREE.Camera,
): { warmGroup: THREE.Group; hooks: ReturnType<typeof getWarmupHooks> } {
  // Non-instanced subjects live under this group; placed at the camera so
  // they're trivially in-frustum (belt — we also force frustumCulled off). The
  // CALLER decides whether to add it to the live scene (WebGL render-to-target)
  // or keep it detached and compile against the scene (WebGPU compileAsync).
  const warmGroup = new THREE.Group();
  warmGroup.position.copy(camera.position);

  // DRAIN THE WARMUP REGISTRY — one seam for everything. Enemies, items,
  // destructibles (content/spawn-warmups.ts) and effects (each effect's own
  // registerWarmup) all add a representative instance here. No hand-maintained
  // content lists in this pass — it just renders whatever registered. This is
  // the LIVE pass, so it runs `live` hooks too (the boot scratch skips them).
  const hooks = getWarmupHooks();
  for (const h of hooks) { try { h.spawn(warmGroup); } catch { /* one bad hook must not sink the pass */ } }
  noCull(warmGroup);
  retainMaterials(warmGroup);   // pin EVERY program the drained instances compiled
  return { warmGroup, hooks };
}

/** TEARDOWN (WebGL) — keep programs, shed resident GPU memory. Materials are
 *  RETAINED (programs stay cached). Effects empty their pools; non-instanced
 *  builds dispose geometry + leave the scene; instanced batches free slots then
 *  dispose the empty batch meshes (segmentCache keeps geometry+material → the
 *  compiled program), so nothing draws parked. */
function teardownWarmSubjects(
  scene: THREE.Scene, warmGroup: THREE.Group, hooks: ReturnType<typeof getWarmupHooks>,
): void {
  for (const h of hooks) { try { h.clear(); } catch { /* skip */ } }
  disposeGeometry(warmGroup);
  scene.remove(warmGroup);
}

/** Run the unified warmup (WebGL path). Idempotent (once per session). Best-
 *  effort. Call after the first level + light pool exist (the scene must hold
 *  the real lights). */
export function runWarmupPass(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): void {
  if (done) return;
  done = true;
  const progBefore = renderer.info.programs?.length ?? 0;
  const { warmGroup, hooks } = buildWarmSubjects(camera);
  scene.add(warmGroup);   // WebGL compiles by rendering the LIVE scene into a target

  // ONE offscreen render — compiles every visible program (floor, props, items,
  // boss bodies, instanced enemy batches, effects) in the live light + shadow
  // context. Tiny target = trivial fill; shadow forced so the cube-depth variant
  // compiles too.
  const target = new THREE.WebGLRenderTarget(16, 16);
  const prevTarget = renderer.getRenderTarget();
  const prevShadowEnabled = renderer.shadowMap.enabled;
  const prevShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(target);
  try { renderer.render(scene, camera); } catch { /* best-effort */ }
  renderer.setRenderTarget(prevTarget);
  renderer.shadowMap.enabled = prevShadowEnabled;
  renderer.shadowMap.needsUpdate = prevShadowNeedsUpdate;
  target.dispose();

  // NB: gore (splat-map stamp/dry ShaderMaterials) is warmed at BOOT in
  // warmupContent, NOT here — its materials are module-level + never disposed
  // (so that warm sticks) and aren't light-keyed (boot context is fine). Doing
  // it here would clobber the live floor's splat bounds.
  teardownWarmSubjects(scene, warmGroup, hooks);

  if (import.meta.env.DEV) {
    const progAfter = renderer.info.programs?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass] +${progAfter - progBefore} programs (${progBefore}→${progAfter}); retained ${retained.length} materials. prog should now hold flat through combat.`);
  }
}

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
    const others = scene.children.filter((c) => c !== warmGroup);
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
    scene.remove(warmGroup);   // pipelines retained via materials; don't dispose geometry
    endLoading();   // game resumes — renders the ready world for the reveal fade
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass:webgpu] chunked warm done (${hooks.length} hooks); retained ${retained.length} materials.`);
  }
}
