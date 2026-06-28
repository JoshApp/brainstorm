import * as THREE from 'three';
import { registerWarmup } from './warmup-registry';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { createMaterialFromDef } from '../ecs/build-model';
import { WARM_MODELS } from './warmup-models';
import { COBWEB_BARRIER } from './cobweb';

// ── Content auto-warmups (CHEAP — materials on dummies, NOT full builds) ──────────
//
// A WebGPU render pipeline's identity is the MATERIAL + the geometry's ATTRIBUTES
// (skinned vs plain) + the render state — NOT the vertex count. So to warm a creature's
// pipeline we do NOT build the creature (CSG + skinning is the heavy, ~seconds-per-roster
// cost that froze boot / lagged play). We create just the MATERIAL with createMaterialFromDef
// — which applies the full WebGPU node setup (reveal / dissolve / gore / chroma), so it
// compiles the EXACT pipeline the live spawn uses — and render it on a TINY dummy mesh of
// the right attribute shape. Same pipeline, ~none of the cost.
//
// The warm pass renders these through the real PSX pipeline (right target format), so the
// compiled pipeline matches the live render and the first real spawn reuses it (no hitch).
// Repeat visits hit the browser's persistent pipeline cache (DawnWebGPUCache) → near-free.
//
// Imported once (main bootstrap) for its module-level side effect.

// Plain (non-skinned) dummy — the variant flung dismember chunks + props/items use.
const WARM_BOX = new THREE.BoxGeometry(0.02, 0.02, 0.02);
WARM_BOX.userData.pooled = true;   // shared — the warm-pass teardown must not dispose it

// Skinned dummy — a quad with skin attributes + bound to a 1-bone skeleton. Compiles the
// SKINNING shader variant (the creature body), which is independent of bone/vert count.
const SKIN_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.02, 0.02);   // position + normal + uv
  const n = g.attributes.position.count;
  const skinIndex = new Uint16Array(n * 4);        // all bone 0
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) skinWeight[i * 4] = 1;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.userData.pooled = true;
  return g;
})();

function addSkinnedWarm(scene: THREE.Object3D, mat: THREE.Material): void {
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(SKIN_GEO, mat);
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.castShadow = false; mesh.frustumCulled = false;
  scene.add(mesh);
}
function addPlainWarm(scene: THREE.Object3D, mat: THREE.Material): void {
  const box = new THREE.Mesh(WARM_BOX, mat);
  box.castShadow = false; box.frustumCulled = false;
  scene.add(box);
}

// ENEMIES — each creature material on BOTH a skinned dummy (the body) AND a plain box (the
// non-skinned flung-chunk variant). Creature materials are forced dissolvable (matches
// buildCreature) so the death-dissolve variant warms.
for (const spec of Object.values(ENEMIES)) {
  registerWarmup({
    label: `enemy:${spec.id}`, live: true,
    spawn: (scene) => {
      for (const def of Object.values(spec.creature.materials)) {
        const mat = createMaterialFromDef(def.dissolvable ? def : { ...def, dissolvable: true });
        addSkinnedWarm(scene, mat);
        addPlainWarm(scene, mat);
      }
    },
    clear: () => {},
  });
}

// ITEMS — floor drop models (plain meshes).
for (const item of Object.values(ITEMS)) {
  registerWarmup({
    label: `item:${item.id ?? item.name}`, live: true,
    spawn: (scene) => {
      for (const def of Object.values(item.dropModel.materials)) addPlainWarm(scene, createMaterialFromDef(def));
    },
    clear: () => {},
  });
}

// STATIC PROPS / CLUTTER / CHESTS / DESTRUCTIBLES — the WARM_MODELS first-class list
// (rubble, bone piles, pillars, sand drifts, chests, vases — incl. VASE_BROKEN's
// gore-receiving material) + the cobweb barrier. These are plain (non-skinned) meshes;
// deeper floors introduce types the first floor lacks, so without warming them they
// compile mid-reveal / when first seen in-play (the hitches). This is the seam to extend:
// add a prop spec to WARM_MODELS and it auto-warms.
for (const spec of [...WARM_MODELS, COBWEB_BARRIER]) {
  registerWarmup({
    label: `prop:${spec.id}`, live: true,
    spawn: (scene) => {
      for (const def of Object.values(spec.materials)) addPlainWarm(scene, createMaterialFromDef(def));
    },
    clear: () => {},
  });
}
