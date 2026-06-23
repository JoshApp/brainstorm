import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { buildCreature } from './build-creature';
import { buildModel, type BuiltModel } from '../ecs/build-model';
import {
  acquireCreatureInstancing, releaseCreatureInstancing,
  disposeEmptyWarmBatches, nextWarmEntityId,
} from '../mobs/creature-instancing';
import { getWarmupHooks } from './warmup-registry';
import type { EntityId } from '../ecs/types';

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
//     buffers (see disposeEmptyWarmBatches).
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

  const instancedIds: EntityId[] = [];

  // ENEMIES — non-bosses through the REAL instanced path (acquire adds the
  // batch InstancedMesh to the scene); bosses render non-instanced in the group.
  for (const spec of Object.values(ENEMIES)) {
    try {
      const creature = buildCreature(spec.creature);
      const container = new THREE.Group();
      container.add(creature.group);
      const built: BuiltModel = {
        group: creature.group, parts: creature.parts, slots: creature.joints,
        materials: creature.materials, hitTargets: creature.hitTargets,
      };
      creature.group.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      const id = nextWarmEntityId();
      const handle = acquireCreatureInstancing(scene, id, spec, built, container);
      if (handle) {
        instancedIds.push(id);
        // segmentCache retains the BATCH material; the batch mesh (frustumCulled
        // false by default) draws on the render below and compiles its program.
      } else {
        noCull(creature.group);
        warmGroup.add(creature.group);
        retainMaterials(creature.group);   // boss: keep its program alive
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
  for (const id of instancedIds) { try { releaseCreatureInstancing(id); } catch { /* skip */ } }
  try { disposeEmptyWarmBatches(); } catch { /* skip */ }

  if (import.meta.env.DEV) {
    const progAfter = renderer.info.programs?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[warmup-pass] +${progAfter - progBefore} programs (${progBefore}→${progAfter}); retained ${retained.length} materials, ${instancedIds.length} instanced enemy types. prog should now hold flat through combat.`);
  }
}
