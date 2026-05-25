import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { addItem } from '../player/inventory';
import { equipWeapon } from '../player/weapon-equip';
import { setCurrentWeapon } from '../player/current-weapon';
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
      addItem(item.id);
      // Weapon items: swap the viewmodel AND update combat stats.
      if (item.viewmodel) equipWeapon(item.viewmodel);
      if (item.weapon) setCurrentWeapon(item.weapon);
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
