import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { rollDropTable } from '../content/drop-tables';
import { registerInteractable, unregisterInteractable } from './system';
import { createPickup } from './pickup';
import { spawnGoldCoins } from '../effects/gold-coins';
import { groundYAt } from '../level/elevation';

// SEARCHABLE — the reusable "make a prop lootable" seam. An ossuary niche, a
// bone pile, a sarcophagus lid: any static model becomes a one-shot container
// with the SAME behaviour every time, so nobody hand-wires a fresh interactable
// per prop (the thing that left the ossuary without an outline and dropping loot
// into its own belly).
//
// It gives an authored prop three things the bespoke version kept forgetting:
//   1. the standard focus OUTLINE — by handing the interactable its `built`
//      model (outline.ts hulls `built.group`; no built = no outline);
//   2. loot that SPEWS forward — items settle half a step out along the model's
//      local +Z (into the room), spread laterally, so nothing lands inside the
//      mesh;
//   3. a clean retire — the interactable/outline/prompt go on the first search;
//      the model itself stays as a monument (keepBuiltOnDestroy semantics via
//      unregister, which never touches the separately-parented group).

/** How far in front of the prop (metres, along local +Z) the loot settles. Just
 *  past a wall-niche's lip so the pile reads as spilling INTO the room. */
const SPEW_FORWARD = 0.7;
/** Lateral gap between multiple items so a bundle fans out, not stacks. */
const SPEW_SPREAD = 0.34;

export interface SearchableOptions {
  scene: THREE.Object3D;
  built: BuiltModel;
  /** World position of the prop's pivot. */
  x: number; y: number; z: number;
  /** Prop facing (Three Y-rotation). Local +Z = (sin, cos) is "forward". */
  rotY: number;
  /** drop-table id to roll on the first search. */
  table: string;
  /** Floor depth (drives the roll's rarity curve). */
  depth: number;
  /** Deterministic RNG for the roll. */
  rng: () => number;
  /** Prompt verb — defaults to 'SEARCH'. */
  label?: string;
  /** Interaction radius — defaults to 1.5m. */
  radius?: number;
}

/** Register a one-shot searchable container around an already-built, already-
 *  scene-added model. Idempotent per call: the FIRST search rolls + spews, then
 *  the interactable retires (outline + prompt gone), leaving the model in place. */
export function registerSearchable(opts: SearchableOptions): void {
  const id = generateEntityId('searchable');
  let searched = false;
  registerInteractable({
    id,
    position: new THREE.Vector3(opts.x, opts.y, opts.z),
    radius: opts.radius ?? 1.5,
    promptLabel: opts.label ?? 'SEARCH',
    // Pass the model so the focus outline has geometry to hull (the miss that
    // left the ossuary un-highlighted). The model is parented to the scene
    // separately, so unregister below drops ONLY the interactable, not the mesh.
    built: opts.built,
    onUse() {
      if (searched) return;
      searched = true;
      unregisterInteractable(id);   // retire the prompt + outline; the model stays
      const bundle = rollDropTable(opts.table, opts.depth, opts.rng);
      spewLootForward(opts.scene, opts.x, opts.y, opts.z, opts.rotY, bundle.items);
      if (bundle.gold > 0) {
        const fx = Math.sin(opts.rotY), fz = Math.cos(opts.rotY);
        spawnGoldCoins(opts.scene, new THREE.Vector3(opts.x + fx * SPEW_FORWARD, opts.y + 0.4, opts.z + fz * SPEW_FORWARD), bundle.gold);
      }
    },
  });
}

/** Settle each item half a step in front of the prop, fanned across the facing
 *  so a bundle doesn't pile on one pixel — the chest's proven spread, aimed
 *  outward instead of sideways-only. */
function spewLootForward(
  scene: THREE.Object3D,
  x: number, y: number, z: number,
  rotY: number,
  items: readonly import('../content/items').ItemSpec[],
): void {
  const fx = Math.sin(rotY), fz = Math.cos(rotY);   // local +Z → forward, into the room
  const px = -fz, pz = fx;                           // perpendicular (lateral spread axis)
  const n = items.length;
  const baseX = x + fx * SPEW_FORWARD;
  const baseZ = z + fz * SPEW_FORWARD;
  items.forEach((item, i) => {
    const lateral = (i - (n - 1) / 2) * SPEW_SPREAD;
    const sx = baseX + px * lateral;
    const sz = baseZ + pz * lateral;
    createPickup(scene, new THREE.Vector3(sx, groundYAt(sx, sz), sz), item);
  });
}
