import * as THREE from 'three';
import { ITEMS } from './items';
import { ENEMIES } from './enemies';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { getItemThumbnail } from '../ui/item-thumbnail';
import { getTexture } from '../style/procedural-textures';
import { getWarmupHooks } from './warmup-registry';
import { resetSplatMap, stampSplat, flushSplats } from '../scene/splat-map';

// Pre-warm caches and JIT paths so the first kill/drop/pickup doesn't hitch.
//
// Three caches we prime at boot:
//   1. Item thumbnails — getItemThumbnail builds the model + renders offscreen.
//      Without warmup, the FIRST inventory rebuild after a pickup pays the
//      cost of N thumbnail renders all at once. Cached forever after.
//   2. Shader programs for drop/enemy models against the MAIN renderer.
//      WebGL compiles a unique program the first time a unique material
//      configuration is rendered. We do a one-frame render of each model in
//      a scratch scene attached to the main renderer so compilation happens
//      now instead of during a fight.
//   3. Geometry/material JIT — buildModel is a hot path; running it once
//      per spec JITs the code.

export function warmupContent(mainRenderer: THREE.WebGLRenderer) {
  // 1. Thumbnails — cheap, fire-and-forget, no main-thread blocking concerns
  //    because thumbnails use their own offscreen renderer.
  for (const item of Object.values(ITEMS)) {
    getItemThumbnail(item);
  }

  // 2 + 3. Compile shaders for drop models + enemy models against the main
  //        renderer. We build each model, render once into a throwaway scene,
  //        then dispose. WebGL compiles the shader program on first render
  //        and reuses it forever for materials with the same uniforms.
  const scratch = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 2);
  cam.lookAt(0, 0, 0);

  // A shadow-casting point light + a receiver floor, so the render below also
  // compiles the SHADOW depth program (point-light cube-map depth). Without it
  // the depth variant compiled the first time a mob cast a shadow in-game — a
  // visible hitch on the first encounter. Mirrors the runtime lamp.
  const shadowLight = new THREE.PointLight(0xffffff, 1, 12, 1.4);
  shadowLight.position.set(0.5, 1.2, 1.5);
  shadowLight.castShadow = true;
  scratch.add(shadowLight);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x222222 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  scratch.add(floor);

  // An additive sprite matching the effect pools' material configuration
  // (status-vfx motes, drifting motes — map + additive + no fog), so the
  // SpriteMaterial program compiles NOW. Without it the first status proc
  // mid-fight compiled it — the alloc profiler caught getProgram running
  // during gameplay.
  const warmSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  warmSprite.position.set(0, 0.5, 0);
  scratch.add(warmSprite);

  // NOTE: enemies / items / destructibles are NOT warmed here anymore. Their
  // materials are render-state-keyed (fog / light count / shadow casters), and
  // this scratch scene has the WRONG state (no fog, 1 light) — warming them here
  // compiled a variant the live render never uses, then the first live render
  // recompiled (the freeze we chased). They're now `live` hooks drained by
  // runWarmupPass in the REAL scene. See content/spawn-warmups.ts.
  //
  // Self-registered effect warmups (gold coins, shatter, wisps, gore, …) — the
  // ones safe in a no-fog scratch. `live` hooks are skipped here.
  const warmupHooks = getWarmupHooks();
  for (const hook of warmupHooks) if (!hook.live) hook.spawn(scratch);

  // One render — primes shader compile for every material that just got added,
  // INCLUDING the shadow depth pass (shadowMap on + a caster + a receiver).
  // WebGL compiles a program the moment a material is rendered, regardless of
  // render target — so we render into a throwaway offscreen target, NOT the
  // canvas (setRenderTarget(null)). Rendering to the canvas flashed the whole
  // roster clustered at the origin on the title screen for a frame.
  // Saved target + shadow flag restored after so the main loop is undisturbed.
  const warmTarget = new THREE.WebGLRenderTarget(8, 8);
  const prevTarget = mainRenderer.getRenderTarget();
  const prevShadow = mainRenderer.shadowMap.enabled;
  mainRenderer.shadowMap.enabled = true;
  // The main loop may run the shadow map on a needsUpdate cadence
  // (autoUpdate off) — force this warmup render to include the shadow pass
  // regardless, or the depth-variant programs don't compile here.
  mainRenderer.shadowMap.needsUpdate = true;
  mainRenderer.setRenderTarget(warmTarget);
  mainRenderer.render(scratch, cam);
  mainRenderer.shadowMap.enabled = prevShadow;
  mainRenderer.setRenderTarget(prevTarget);
  warmTarget.dispose();
  scratch.remove(shadowLight, floor, warmSprite);
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  warmSprite.material.dispose();   // texture stays cached in procedural-textures

  // Empty the effect pools the warmup hooks filled — the programs are now
  // compiled (cached in WebGL + the effects' module-level material caches);
  // the JS instances are no longer needed and must not tick during gameplay.
  for (const hook of warmupHooks) if (!hook.live) hook.clear();

  // Splat-map gore shaders — the stamp/dry ShaderMaterials (scene/splat-map.ts)
  // are CREATED at initSplatMap but only COMPILE on the first blood stamp, so
  // the first hit/kill compiled them inside render() — a death-frame `prog`
  // tick + hitch in the perf recordings. Warm them now: temp bounds so the
  // stamp lands, queue one floor stamp, flush (renders → compiles stamp + dry
  // passes), then reset (the real level load resets bounds again). Best-effort.
  try {
    resetSplatMap(0, 0, 64, 64);
    stampSplat(32, 32, 1.0, 0x5a0204, 0.8, { x: 1, z: 0 });
    flushSplats(mainRenderer);
    resetSplatMap(0, 0, 1, 1);
  } catch { /* pre-warm is best-effort */ }

}

/** Pre-compile the spawnable enemy roster's shaders IN THE LIVE scene's
 *  lighting — the slot pool's full PointLight count + the live fog/banded
 *  define. boot warmupContent compiles them against a 1-light scratch scene,
 *  but Three keys its program cache on light count, so the FIRST live spawn
 *  re-compiles synchronously inside render() — a measured ~190ms freeze on an
 *  ooze spawn (perf recording, prog +1 on the spike frame, 165ms in
 *  render·scene). Compiling against the real scene makes spawns resident +
 *  hitch-free. Async (KHR_parallel_shader_compile) so it never blocks the load
 *  frame; the roster is DETACHED (the targetScene arg supplies the lights) so
 *  nothing flashes on screen. Best-effort — disposes the throwaway builds when
 *  the compile resolves. Call once, after the first level + light pool exist. */
export async function precompileRosterInScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<void> {
  const roster = new THREE.Group();
  for (const enemy of Object.values(ENEMIES)) {
    try {
      const group = buildCreature(enemy.creature).group;
      group.traverse((o) => { (o as THREE.Mesh).castShadow = true; });  // prime the cube-depth variant too
      roster.add(group);
    } catch { /* a bad spec must not sink the whole pre-warm */ }
  }
  // ITEM DROP MODELS too — boot warmup compiled these against the 1-light
  // scratch scene, so the FIRST loot drop in a torchlit room recompiled at the
  // live light count (a no-event `prog` tick + hitch in the recordings). Compile
  // them here in the real scene so the first pickup-on-the-floor is hitch-free.
  for (const item of Object.values(ITEMS)) {
    try { roster.add(buildModel(item.dropModel).group); }
    catch { /* a bad spec must not sink the whole pre-warm */ }
  }
  // compileAsync(object, camera, targetScene): compile `roster`'s materials
  // using the lights found in the LIVE `scene`. Parallel + non-blocking.
  try { await renderer.compileAsync(roster, camera, scene); }
  catch { /* parallel-compile unsupported / driver quirk — best-effort */ }
  roster.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
    mesh.geometry.dispose();
  });
}
