import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { buildCreature } from './build-creature';
import { buildModel } from '../ecs/build-model';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { getWarmupHooks } from './warmup-registry';
import { setWebGPUWarming } from '../scene/renderer-mode';

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
  scene: THREE.Scene, camera: THREE.Camera,
): { warmGroup: THREE.Group; hooks: ReturnType<typeof getWarmupHooks> } {
  // Non-instanced subjects render under this group; placed at the camera so
  // they're trivially in-frustum (belt — we also force frustumCulled off).
  const warmGroup = new THREE.Group();
  warmGroup.position.copy(camera.position);
  scene.add(warmGroup);

  // ENEMIES — fold each creature into its rigid-skinned SkinnedMesh (the live
  // render path, docs/CREATURE-RENDER-V2.md) and add it so the compile below
  // covers the SKINNING shader variant — otherwise the first enemy spawn
  // in-game recompiles it and hitches. castShadow stays false (blob shadow), as
  // the builder sets, so the skinned-shadow variant isn't (and needn't be) warmed.
  const warmBox = new THREE.BoxGeometry(0.02, 0.02, 0.02);   // shared; warms the NON-skinned variant
  for (const spec of Object.values(ENEMIES)) {
    try {
      const creature = buildCreature(spec.creature);
      buildSkinnedCreature(creature);
      noCull(creature.group);
      warmGroup.add(creature.group);
      retainMaterials(creature.group);   // keep the skinned program alive
      // Flung dismember chunks (sever/crumble) are PLAIN, non-skinned meshes that
      // reuse these same materials. The skinned mesh above only compiles the
      // SKINNING variant, so without this the first death/sever of each type
      // recompiles the non-skinned variant mid-combat → a ~270ms freeze. A
      // tiny box per material (castShadow false, like a chunk) warms it now.
      for (const m of creature.materials.values()) {
        const box = new THREE.Mesh(warmBox, m);
        box.castShadow = false; box.frustumCulled = false;
        warmGroup.add(box);
      }
    } catch { /* one bad spec must not sink the pass */ }
  }

  // ITEMS — floor drop models.
  for (const item of Object.values(ITEMS)) {
    try {
      const g = buildModel(item.dropModel).group;
      noCull(g);
      warmGroup.add(g);
      retainMaterials(g);
    } catch { /* skip a bad drop spec */ }
  }

  // EFFECTS — self-registered pools (shatter/coins/wisps/…) spawn a
  // representative instance; their materials live module-level in each effect,
  // so the program is retained without us tracking it.
  const hooks = getWarmupHooks();
  for (const h of hooks) { try { h.spawn(warmGroup); } catch { /* skip */ } }
  noCull(warmGroup);
  return { warmGroup, hooks };
}

/** TEARDOWN — keep programs, shed resident GPU memory. Materials are RETAINED
 *  (programs/pipelines stay cached). Effects empty their pools; non-instanced
 *  builds dispose geometry + leave the scene; instanced batches free slots then
 *  dispose the empty batch meshes (segmentCache keeps geometry+material → the
 *  compiled program), so nothing draws parked.
 *
 *  `disposeGeo`: WebGL frees the warm geometry's buffers here. The WebGPU backend
 *  must NOT — compileAsync has already uploaded those geometries to GPU buffers
 *  the backend tracks, and disposing them destroys buffers still referenced by
 *  the live render's command submission ("Buffer used in submit while destroyed"
 *  → black screen). The warm geometry is tiny; we keep it resident (just removed
 *  from the scene so it never draws) rather than risk a shared-buffer destroy. */
function teardownWarmSubjects(
  scene: THREE.Scene, warmGroup: THREE.Group, hooks: ReturnType<typeof getWarmupHooks>,
  disposeGeo = true,
): void {
  for (const h of hooks) { try { h.clear(); } catch { /* skip */ } }
  if (disposeGeo) disposeGeometry(warmGroup);
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
  const { warmGroup, hooks } = buildWarmSubjects(scene, camera);

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
 *  compiles a render PIPELINE per material/state via `compileAsync` — no
 *  WebGLRenderTarget. Gated by `setWebGPUWarming` so the main loop SKIPS drawing
 *  while the warm subjects are parented in the live scene (else they'd flash
 *  on-screen at the camera), which doubles as the first-frame gate: the first
 *  real frame waits behind the compile instead of racing it (the lazy compile-
 *  mid-frame stall — the ~89ms-for-25k-tris symptom — this whole pass prevents).
 *  Idempotent (shares the `done` guard with the WebGL path) and best-effort: a
 *  driver hiccup must not brick the load, and the gate is ALWAYS cleared. */
export async function runWarmupPassWebGPU(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): Promise<void> {
  if (done) return;
  done = true;
  setWebGPUWarming(true);
  let built: { warmGroup: THREE.Group; hooks: ReturnType<typeof getWarmupHooks> } | null = null;
  try {
    built = buildWarmSubjects(scene, camera);
    // compileAsync awaits backend init internally and compiles a pipeline for
    // every material/state combo now resident in the scene (floor + props +
    // the warm roster), in the live light/shadow context.
    await (renderer as unknown as {
      compileAsync: (s: THREE.Scene, c: THREE.Camera) => Promise<unknown>;
    }).compileAsync(scene, camera);
  } catch { /* best-effort — a driver hiccup must not brick the load */ } finally {
    // disposeGeo=false: see teardownWarmSubjects — the node backend tracks the
    // warm geometries' GPU buffers after compileAsync; destroying them here
    // corrupts the live render's submission (black screen).
    if (built) teardownWarmSubjects(scene, built.warmGroup, built.hooks, false);
    setWebGPUWarming(false);
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass:webgpu] roster pipelines compiled (enemies/items/effects); retained ${retained.length} materials. combat spawns should not hitch.`);
  }
}
