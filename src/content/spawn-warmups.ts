import * as THREE from 'three';
import { registerWarmup } from './warmup-registry';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { buildModel, createMaterialFromDef, setRevealAttributes } from '../ecs/build-model';
import { WARM_MODELS } from './warmup-models';
import { COBWEB_BARRIER } from './cobweb';
import { getTexture } from '../style/procedural-textures';
import { primeFloorPalette, registeredFloorMaterials } from '../style/material-registry';
import { ACTS } from '../level/acts';
import { SKELETONS, resolveProportions } from './skeletons';

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

// GEOMETRY-LAYOUT PARITY — the render object's cache key includes the exact
// attribute NAME SET and the INDEXED bit (RenderObject.getGeometryCacheKey), so
// a dummy warms a REAL variant only when both match the live mesh. Live layouts
// observed (2026-07-04):
//   - death/sever chunks (creature-skinned buildChunk): NON-indexed,
//     position+normal+uv+aReveal*
//   - placed/dropped item + prop models: indexed, position+normal+uv, NO
//     aReveal attributes
//   - CSG-built parts: non-indexed, can be position+normal only (no uv)
// A mismatched dummy is PHANTOM coverage: the first live use pays the full TSL
// node build in-play (~100ms CPU on the phone, pipeline count unchanged — the
// recorded death-frame spikes; placed props were rescued by the per-floor
// warmSceneCompile, but mid-play LOOT DROPS were not).
const WARM_BOX_NOIDX = WARM_BOX.toNonIndexed();
WARM_BOX_NOIDX.userData.pooled = true;
setRevealAttributes(WARM_BOX_NOIDX, undefined, true);
// Item/prop variants — no reveal attributes (models are built reveal-less).
const WARM_BOX_MODEL = new THREE.BoxGeometry(0.02, 0.02, 0.02);
WARM_BOX_MODEL.userData.pooled = true;
const WARM_BOX_MODEL_NOIDX = WARM_BOX_MODEL.toNonIndexed();
WARM_BOX_MODEL_NOIDX.userData.pooled = true;
// (A third layout exists in the wild — uv-less CSG output, position+normal only
// — but it's rare enough that its once-per-session lazy build beats taxing the
// EVERY-OPEN boot warm with another builder run per material. The boot warm is
// CPU-bound — node builds don't disk-cache — so each dummy variant here is a
// per-open cost on the phone loop; warm only what hitches combat beats.)

// Skinned dummy — skin attributes + bound to a 1-bone skeleton. Compiles the
// SKINNING shader variant (the creature body), which is independent of bone/vert count.
// NON-indexed: creature-skinned normalizeForSkin forces every live creature body
// non-indexed, and the index bit is part of the cache key (see WARM_BOX_NOIDX) —
// an indexed skinned dummy warms a variant NO live creature ever uses.
const SKIN_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.02, 0.02).toNonIndexed();   // position + normal + uv
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

function addSkinnedWarm(scene: THREE.Object3D, mat: THREE.Material, boneCount = 1): void {
  // BONE COUNT MATTERS: RenderObject's cache key appends skeleton.bones.length,
  // so a 1-bone dummy warms a node-builder entry NO real creature hits. Pass the
  // species' real joint count (see enemyBoneCount) or the first live spawn pays
  // the full TSL node build in-play.
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < Math.max(1, boneCount); i++) bones.push(new THREE.Bone());
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
  const mesh = new THREE.SkinnedMesh(SKIN_GEO, mat);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = false; mesh.frustumCulled = false;
  scene.add(mesh);
}

/** A species' live skeleton bone count — the same joints list buildCreature
 *  turns into bones (creature.joints = the compiled skeleton's joints, 1:1).
 *  Resolved from DATA (no geometry build): archetype skeleton fn or explicit
 *  skeleton override. */
function enemyBoneCount(spec: (typeof ENEMIES)[keyof typeof ENEMIES]): number {
  try {
    const c = spec.creature;
    const skel = c.skeleton ?? SKELETONS[c.archetype](resolveProportions(c.archetype, c.proportions));
    return skel.joints.length;
  } catch { return 1; }
}
// Chunk variant (creature materials): non-indexed + aReveal, matching buildChunk.
function addChunkWarm(scene: THREE.Object3D, mat: THREE.Material): void {
  const box = new THREE.Mesh(WARM_BOX_NOIDX, mat);
  box.castShadow = false; box.frustumCulled = false;
  scene.add(box);
}
// Model variants (items/props/decor): the reveal-less layouts live drops use —
// indexed (merged primitives) + non-indexed (CSG parts).
function addPlainWarm(scene: THREE.Object3D, mat: THREE.Material): void {
  for (const geo of [WARM_BOX_MODEL, WARM_BOX_MODEL_NOIDX]) {
    const box = new THREE.Mesh(geo, mat);
    box.castShadow = false; box.frustumCulled = false;
    scene.add(box);
  }
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
      const bones = enemyBoneCount(spec);
      for (const def of Object.values(spec.creature.materials)) {
        const mat = createMaterialFromDef(def.dissolvable ? def : { ...def, dissolvable: true });
        addSkinnedWarm(scene, mat, bones);   // the body (non-indexed, aReveal, real bone count)
        addChunkWarm(scene, mat);            // the flung death/sever chunk variant
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
    const sprite = (blending: THREE.Blending, fog: boolean, depthTest = true): THREE.Sprite => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: wisp, transparent: true, blending, depthWrite: false, fog, depthTest }));
      s.frustumCulled = false; s.position.set(0, 0.5, 0);
      return s;
    };
    // additive (eye-halos / glows) + normal, each with and without fog — the 4 sprite pipelines.
    scene.add(sprite(THREE.AdditiveBlending, true), sprite(THREE.AdditiveBlending, false));
    scene.add(sprite(THREE.NormalBlending, true), sprite(THREE.NormalBlending, false));
    // depthTest-OFF additive — the VIEWMODEL overlay sprites (flask glow, lamp
    // flame layers: depth always + additive). The flask's glow first renders on
    // the first mid-fight sip, which compiled this variant IN PLAY — a ~120ms
    // hitch on the phone (2026-07-03 recording, verified by __compileReport's
    // "depth w0:always vs w0:less-equal" mismatch). Both fog states.
    scene.add(sprite(THREE.AdditiveBlending, true, false), sprite(THREE.AdditiveBlending, false, false));
    // …and normal-blended depth-off (breath puffs, over-viewmodel wisps).
    scene.add(sprite(THREE.NormalBlending, true, false), sprite(THREE.NormalBlending, false, false));
    // basic unlit (simple effect/decal meshes): normal AND additive blending
    // (additive was missing — pickup range rings + additive decals compiled
    // their MeshBasic pipeline on first sight in play), fog + no-fog, the
    // depth-write-off variant additive effects use, and BOTH cull modes —
    // rings/decals are DoubleSide, which is its own pipeline (the guard's
    // "prim triangle-list/back vs none" mismatch).
    for (const fog of [true, false]) {
      for (const blending of [THREE.NormalBlending, THREE.AdditiveBlending]) {
        for (const side of [THREE.FrontSide, THREE.DoubleSide]) {
          const m = new THREE.Mesh(WARM_BOX, new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, fog, blending, side,
            depthWrite: blending === THREE.NormalBlending,
          }));
          m.castShadow = false; m.frustumCulled = false;
          scene.add(m);
        }
      }
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

// CSG MODELS — the one place where BUILDING, not compiling, is the cost.
//
// Everything else on this page warms a PIPELINE: a material on a tiny dummy, no
// build, because buildCreature/buildModel is the heavy part we deliberately keep
// out of the warm. A boolean is the exception. Measured 2026-08-05: the skeleton
// key (a skull with two sockets subtracted) costs ~107ms on its first build and
// ~37ms on every one after — so the first key the dungeon ever paid you froze a
// frame, and every key after it dropped another. build-model's CSG_CACHE takes
// the repeats to ~2ms; this takes the FIRST one behind the loading veil, which is
// the whole point of having a veil.
//
// DETECTED, NOT LISTED. A hand-written list is how the last audit of this missed
// the key entirely — a walker that only followed `children` never saw that CSG
// operands live under `a`/`b`. So this walks every value of every object and asks
// one question, which stays true however the spec shape grows. That matters
// doubly here: the content layer authors these specs, and a warm it has to
// remember to opt into is a warm that silently rots.
function containsCsg(node: unknown, depth = 0): boolean {
  if (depth > 12 || node === null || typeof node !== 'object') return false;
  if ((node as { kind?: string }).kind === 'csg') return true;
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (containsCsg(v, depth + 1)) return true;
  }
  return false;
}

for (const item of Object.values(ITEMS)) {
  const specs = [item.dropModel, item.viewmodel].filter((s) => s && containsCsg(s));
  if (!specs.length) continue;
  registerWarmup({
    label: `csg:${item.id ?? item.name}`, live: true,
    // Nothing is added to the scratch scene: the work IS the build, banked into
    // build-model's CSG_CACHE. The pipelines these models need are already
    // covered by the item/viewmodel material warms above.
    spawn: () => { for (const s of specs) { try { buildModel(s!); } catch { /* a bad spec is its own bug */ } } },
    clear: () => {},
  });
}

// WEAPON VIEWMODELS — the held first-person models. Built ONLY on equip and NOT
// covered by the drop-model warm above (a viewmodel differs from its drop
// model, e.g. the wand's arcane orb + halo). So switching weapons compiled their
// pipelines LIVE — which BLACK-SCREENED the mage staff on real WebGPU: its
// additive 'fire-wisp' SPRITE is the only sprite in ANY weapon viewmodel, and a
// sprite pipeline (SpriteNodeMaterial) is a distinct variant from every warmed
// mesh material, so the live compile faulted (headless tolerates it — the snap
// renders it fine). Weapon viewmodels are cheap primitives (no skinning), so we
// build each for REAL once, warming the exact mesh AND sprite pipelines equip
// reuses. buildModel adds a real THREE.Sprite, so its material warms here.
for (const item of Object.values(ITEMS)) {
  const vm = item.viewmodel;
  if (!vm) continue;
  let warmed: THREE.Object3D | null = null;
  registerWarmup({
    label: `viewmodel:${item.id ?? item.name}`, live: true,
    spawn: (scene) => { warmed = buildModel(vm).group; scene.add(warmed); },
    clear: () => { warmed?.parent?.remove(warmed); warmed = null; },
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
