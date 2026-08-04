import * as THREE from 'three';
import { spawnOffering } from './offering';
import { setSlot } from '../player/equipment';
import { emit } from '../broadcast/event-bus';
import type { ItemSpec } from '../content/items';
import type { StyleMaterials } from '../style/materials';

// Starter-altar — a stone block with one of three offered weapons floating +
// slowly rotating above it. Lives ONLY in the starter chamber.
//
// This is now just an OFFERING (interactables/offering.ts) with a bespoke take:
// the three altars share a group id, so taking one closes the other two and
// leaves their stones standing empty. You walked past two rejected altars; you
// keep walking past two empty ones. Commitment-by-absence.
//
// The stair-unlock predicate (has-equipment: weapon) flips the stairwell from
// SEALED to DESCEND the moment the weapon is set, with no wiring here.

/** Every starter altar on a floor belongs to this one choice. */
const STARTER_GROUP = 'starter-altar';

/**
 * Spawn a starter altar (stone block + offered weapon).
 *
 * @param onDestroy Owner-supplied cleanup — the builder's hook for removing the
 *                  altar's collision AABB. (Today the stone REMAINS a collider
 *                  after the weapon is taken, so the builder passes nothing;
 *                  the hook stays wired for a future walk-through-empty-altar.)
 */
export function spawnStarterAltar(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  weaponItem: ItemSpec,
  materials: StyleMaterials,
  onDestroy?: () => void,
) {
  spawnOffering(
    { item: weaponItem, pos, rotY },
    {
      kind: 'starter-altar',
      scene,
      materials,
      style: 'pedestal',
      groupId: STARTER_GROUP,
      // The opening choice is a stat-for-stat comparison of three weapons you
      // know nothing about — so all three show their numbers at once rather than
      // making you walk to each. Every later trove uses the lean-in default.
      leanInForStats: false,
      onDestroy,
      // Bespoke take: the FIRST weapon is set directly into the slot rather than
      // routed through ground-equip — there is nothing to compare against yet,
      // and main.ts's equipment listener swaps the viewmodel off the slot change.
      onTake: (item) => {
        setSlot('weapon', item);
        emit({ type: 'starter:chosen', weaponId: item.id });
      },
    },
  );
}
