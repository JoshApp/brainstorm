import * as THREE from 'three';
import { ITEMS } from './items';
import { ENEMIES } from './enemies';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { getItemThumbnail } from '../ui/item-thumbnail';
import { getTexture } from '../style/procedural-textures';
import { getWarmupHooks } from './warmup-registry';

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

  const models: THREE.Object3D[] = [];
  for (const item of Object.values(ITEMS)) {
    const built = buildModel(item.dropModel);
    scratch.add(built.group);
    models.push(built.group);
  }
  for (const enemy of Object.values(ENEMIES)) {
    // The whole roster is creature-based now. buildCreature runs the same
    // buildModel + mergeRigidSegments pipeline internally, so one build per
    // enemy spec primes the merged mesh layout AND its shader set — exactly
    // what the in-game mob renders. (Legacy `enemy.model` enemies are gone;
    // the bespoke marrow/mimic geometry is reached through their creature
    // specs' custom skeletons, so it warms here too.)
    const group = buildCreature(enemy.creature).group;
    group.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    scratch.add(group);
    models.push(group);
  }

  // Self-registered effect warmups — gold coins, shatter debris, essence wisps,
  // and anything else that dropped a registerWarmup() next to its spawn/clear.
  // Each adds a representative instance to the scratch scene so its material
  // program compiles in the one render below, instead of hitching on the first
  // kill/proc mid-fight. The matching clear() runs after the render to empty the
  // pools again (a warmup instance must never tick in real gameplay).
  // See content/warmup-registry.ts.
  const warmupHooks = getWarmupHooks();
  for (const hook of warmupHooks) hook.spawn(scratch);

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
  for (const hook of warmupHooks) hook.clear();

  // Dispose — the geometries/materials live in WebGL forever via the program
  // cache; we just don't need the JS Object3Ds anymore.
  for (const group of models) {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
        mesh.geometry.dispose();
      }
    });
  }
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
