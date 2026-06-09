import * as THREE from 'three';
import { ITEMS } from './items';
import { ENEMIES } from './enemies';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { getItemThumbnail } from '../ui/item-thumbnail';

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
  mainRenderer.setRenderTarget(warmTarget);
  mainRenderer.render(scratch, cam);
  mainRenderer.shadowMap.enabled = prevShadow;
  mainRenderer.setRenderTarget(prevTarget);
  warmTarget.dispose();
  scratch.remove(shadowLight, floor);
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();

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
