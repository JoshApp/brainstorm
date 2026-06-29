import * as THREE from 'three';
import { registerWarmup } from './warmup-registry';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { createMaterialFromDef, setRevealAttributes } from '../ecs/build-model';
import { WARM_MODELS } from './warmup-models';
import { COBWEB_BARRIER } from './cobweb';
import { getTexture } from '../style/procedural-textures';
import { primeFloorPalette, registeredFloorMaterials } from '../style/material-registry';
import { ACTS } from '../level/acts';

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
// The reveal colours ride on per-vertex aReveal* attributes (build-model), so the live reveal geometry
// carries them and the shader CONSUMES them → they're part of the vertex layout → part of the pipeline.
// The warm dummy must carry the same layout or it warms a DIFFERENT pipeline than the live spawn. Zeros
// are fine — only the attribute's presence/shape matters for the pipeline, not the values.
setRevealAttributes(WARM_BOX, undefined, true);

// Skinned dummy — a quad with skin attributes + bound to a 1-bone skeleton. Compiles the
// SKINNING shader variant (the creature body), which is independent of bone/vert count.
const SKIN_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.02, 0.02);   // position + normal + uv
  const n = g.attributes.position.count;
  // skinIndex must be FLOAT32 to match the live creature: creature-skinned normalizeForSkin builds
  // skinIndex as a Float32 BufferAttribute, and the vertex-attribute FORMAT (float32x4 vs uint16x4) is
  // part of the pipeline key. A Uint16 dummy warmed a DIFFERENT pipeline than live spawns → every
  // spawned-during-play creature recompiled (the descent warm only covered placed ones). Match it.
  const skinIndex = new Float32Array(n * 4);        // all bone 0
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) skinWeight[i * 4] = 1;
  g.setAttribute('skinIndex', new THREE.Float32BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  setRevealAttributes(g, undefined, true);   // same aReveal* layout as the live creature body (see WARM_BOX)
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
// Instanced dummy — floor decor (sigils/cracks/rubble/niches) renders as InstancedMesh, whose
// instanceMatrix attribute makes it a DISTINCT pipeline variant from a plain mesh. Warming on a
// plain box alone would miss it. One instance, identity transform.
const IDENTITY_M4 = new THREE.Matrix4();
function addInstancedWarm(scene: THREE.Object3D, mat: THREE.Material): void {
  const inst = new THREE.InstancedMesh(WARM_BOX, mat, 1);
  inst.setMatrixAt(0, IDENTITY_M4);
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false; inst.frustumCulled = false;
  scene.add(inst);
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

// NON-MeshStandard PRIMITIVES — the cheap warm above only covers MeshStandard (enemy/prop
// bodies). But models + effects also use SPRITES (enemy eye-halos: additive 'fire-wisp';
// status motes), POINTS, and BASIC materials — each a DISTINCT pipeline, keyed on blending +
// fog. Those were compiling when first SEEN in-play (the compile-watch surfaced exactly these:
// SpriteMaterial / PointsNodeMaterial / MeshBasicMaterial). Warm a representative of each
// variant here so they're ready before the first enemy / proc / particle.
registerWarmup({
  label: 'primitive:sprites+basic', live: true,
  spawn: (scene) => {
    const wisp = getTexture('fire-wisp');
    const sprite = (blending: THREE.Blending, fog: boolean): THREE.Sprite => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: wisp, transparent: true, blending, depthWrite: false, fog }));
      s.frustumCulled = false; s.position.set(0, 0.5, 0);
      return s;
    };
    // additive (eye-halos / glows) + normal, each with and without fog — the 4 sprite pipelines.
    scene.add(sprite(THREE.AdditiveBlending, true), sprite(THREE.AdditiveBlending, false));
    scene.add(sprite(THREE.NormalBlending, true), sprite(THREE.NormalBlending, false));
    // basic unlit (simple effect/decal meshes), fog + no-fog.
    for (const fog of [true, false]) {
      const m = new THREE.Mesh(WARM_BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog }));
      m.castShadow = false; m.frustumCulled = false;
      scene.add(m);
    }
  },
  clear: () => {},
});

// FLOOR DECOR — the closed decorate/builder/chandelier palette (PIPELINE-BUDGET Pillar 1b/2/3).
// Prime the whole set × the bounded per-act tints, then warm each material on an INSTANCED
// dummy (decor renders as InstancedMesh — a distinct pipeline from plain meshes) AND a plain
// dummy (breach cavity, chandelier ring). Compiles the floor-decor pipelines at BOOT so the
// first room-reveal reuses them instead of compiling in-play (the hitch you walk into).
registerWarmup({
  label: 'floor-decor', live: true,
  spawn: (scene) => {
    primeFloorPalette(ACTS.map((a) => a.torchTint));
    for (const mat of registeredFloorMaterials()) {
      addInstancedWarm(scene, mat);
      addPlainWarm(scene, mat);
    }
  },
  clear: () => {},
});

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
