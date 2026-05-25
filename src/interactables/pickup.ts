import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { addItem, removeItem, addItemSilently } from '../player/inventory';
import { tryAutoEquip, equipFromInventory } from '../player/equipment';
import type { ItemSpec } from '../content/items';

// Pickup interactable: a loot model floating on the floor that the player
// can walk up to and TAKE. Takes an ItemSpec (not just a model) so it
// knows the item id (for inventory tracking + the pickup-notification
// display name) and whether the item is a weapon that should be equipped
// on pickup.
//
// The model bobs gently and slowly rotates so it reads as an item-of-
// interest, not set dressing.

const BOB_AMPLITUDE = 0.04;
const BOB_FREQUENCY = 1.8;
const ROTATE_SPEED = 0.5;  // rad/s

export function createPickup(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  item: ItemSpec,
) {
  const built = buildModel(item.dropModel);
  // Center the item at floor + a small lift so it floats above the ground
  // (rather than half-buried in the floor mesh).
  built.group.position.copy(pos);
  built.group.position.y = Math.max(pos.y, 0.35);
  scene.add(built.group);

  const baseY = built.group.position.y;
  let t = 0;
  const id = generateEntityId('pickup');

  const interactable = {
    id,
    position: pos.clone(),
    radius: 1.0,
    promptLabel: 'TAKE',
    onUse() {
      // Always notify (pickup-notification toast + listener UIs) by
      // calling addItem first, then move the item OUT of the bag if it
      // was auto-equipped. Weapons always equip; rings/armor only if a
      // slot is empty; consumables always stay in the bag.
      addItem(item.id);
      if (item.kind === 'weapon') {
        // Weapons always equip on pickup (replace current).
        const previous = equipFromInventory(item);
        if (previous) addItemSilently(previous.id);   // old weapon back to bag
        removeItem(item.id);                          // new weapon out of bag
      } else if (item.kind === 'ring' || item.kind === 'armor') {
        // Rings/armor auto-equip only if a matching slot is empty.
        if (tryAutoEquip(item)) removeItem(item.id);
      }
      // Weapon viewmodel + combat stats now driven reactively by the
      // equipment-changed listener in main.ts; no manual call here.
      interactable.destroyed = true;
    },
    tick(dt: number) {
      t += dt;
      // Bob gently up and down.
      built.group.position.y = baseY + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;
      // Stand upright; rotate slowly around the world Y axis (like an
      // item-of-interest in a JRPG).
      built.group.rotation.y += ROTATE_SPEED * dt;
    },
    destroyed: false,
    built,
  };
  registerInteractable(interactable);
}
