import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { buildCreature } from './build-creature';
import { buildModel } from '../ecs/build-model';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN } from './vase';
import { COBWEB_BARRIER } from './cobweb';
import { getWarmupHooks } from './warmup-registry';

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

/** Run the unified warmup. Idempotent (once per session). Best-effort — any
 *  single subject failing must not sink the pass. Call after the first level +
 *  light pool exist (the scene must hold the real lights). */
export function runWarmupPass(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): void {
  if (done) return;
  done = true;
  const progBefore = renderer.info.programs?.length ?? 0;

  // Non-instanced subjects render under this group; placed at the camera so
  // they're trivially in-frustum (belt — we also force frustumCulled off).
  const warmGroup = new THREE.Group();
  warmGroup.position.copy(camera.position);
  scene.add(warmGroup);

  // ENEMIES — fold each creature into its rigid-skinned SkinnedMesh (the live
  // render path, docs/CREATURE-RENDER-V2.md) and add it so the render below
  // compiles the SKINNING shader variant — otherwise the first enemy spawn
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
      // recompiles the non-skinned variant mid-combat → a ~270ms freeze. Render a
      // tiny box per material (castShadow false, like a chunk) to warm it now.
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

  // DESTRUCTIBLES — vases sit in the scene at level-build (warmed by the load-
  // time compile), but VASE_BROKEN spawns ON BREAK mid-combat, so its material
  // (tinted + gore-receiving = the enemy-ext|0|0|1|1 variant seen compiling
  // in-fight) is otherwise first-rendered live. Warm every variant in the live
  // (fogged) scene so the useFog/flatShading variant matches and nothing
  // recompiles when a pot shatters.
  for (const spec of [VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN, COBWEB_BARRIER]) {
    try {
      const g = buildModel(spec).group;
      noCull(g);
      warmGroup.add(g);
      retainMaterials(g);
    } catch { /* skip a bad spec */ }
  }

  // EFFECTS — self-registered pools (shatter/coins/wisps/…) spawn a
  // representative instance; their materials live module-level in each effect,
  // so the program is retained without us tracking it.
  const hooks = getWarmupHooks();
  for (const h of hooks) { try { h.spawn(warmGroup); } catch { /* skip */ } }
  noCull(warmGroup);

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

  // ── TEARDOWN — keep programs, shed resident GPU memory ──────────────────────
  // Materials are RETAINED (programs stay cached). Effects: empty their pools.
  // Non-instanced builds: dispose geometry + remove from scene. Instanced: free
  // slots, then dispose the empty batch meshes + drop them from the live map
  // (segmentCache keeps geometry+material → program), so nothing draws parked.
  for (const h of hooks) { try { h.clear(); } catch { /* skip */ } }
  disposeGeometry(warmGroup);
  scene.remove(warmGroup);

  if (import.meta.env.DEV) {
    const progAfter = renderer.info.programs?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass] +${progAfter - progBefore} programs (${progBefore}→${progAfter}); retained ${retained.length} materials. prog should now hold flat through combat.`);
  }
}
