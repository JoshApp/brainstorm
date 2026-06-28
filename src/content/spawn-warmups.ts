import * as THREE from 'three';
import { registerWarmup } from './warmup-registry';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { buildCreature } from './build-creature';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { buildModel } from '../ecs/build-model';
import { VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN } from './vase';
import { COBWEB_BARRIER } from './cobweb';

// ── Content auto-warmups ─────────────────────────────────────────────────────
//
// Completes the self-registering warmup architecture (warmup-registry.ts) for
// the BULK content registries — enemies, items, destructibles — so they stop
// being hand-maintained god-lists inside the warmup pass. Each registers a
// `live: true` hook: it runs ONLY in runWarmupPass's real (fogged, full-light,
// shadowed) scene, never the boot scratch — because a material's program is
// keyed on render state (useFog / light count / shadow casters), so warming in
// the scratch compiles the WRONG variant and the first live render recompiles.
//
// A representative instance carries the worst-case material set, so rendering it
// compiles every program the live spawn will need. Geometry is disposed in the
// pass teardown (it disposes the warm group); materials are retained there so
// the programs stay pinned. clear() is therefore a no-op for these.
//
// Imported once (main bootstrap) for its module-level side effect.

const WARM_BOX = new THREE.BoxGeometry(0.02, 0.02, 0.02);   // shared; for non-skinned variants

// ENEMIES — the skinned body (skinning variant) PLUS a tiny box per material
// (the NON-skinned variant the flung dismember chunks use). Both at the live
// light/shadow/fog count.
for (const spec of Object.values(ENEMIES)) {
  registerWarmup({
    label: `enemy:${spec.id}`,
    live: true,
    spawn: (scene) => {
      const creature = buildCreature(spec.creature);
      buildSkinnedCreature(creature);
      scene.add(creature.group);
      for (const m of creature.materials.values()) {
        const box = new THREE.Mesh(WARM_BOX, m);
        box.castShadow = false; box.frustumCulled = false;
        scene.add(box);
      }
    },
    clear: () => { /* geometry + materials handled by the pass teardown */ },
  });
}

// ITEMS — floor drop models.
for (const item of Object.values(ITEMS)) {
  registerWarmup({
    label: `item:${item.id ?? item.name}`,
    live: true,
    spawn: (scene) => { scene.add(buildModel(item.dropModel).group); },
    clear: () => {},
  });
}

// DESTRUCTIBLES — vases sit in the scene at level-build, but VASE_BROKEN spawns
// on break mid-combat, so its (tinted, gore-receiving) material is otherwise
// first-rendered live. Warm every variant.
for (const spec of [VASE_TALL, VASE_SQUAT, VASE_FLASK, VASE_BROKEN, COBWEB_BARRIER]) {
  registerWarmup({
    label: `destructible:${spec.id}`,
    live: true,
    spawn: (scene) => { scene.add(buildModel(spec).group); },
    clear: () => {},
  });
}
