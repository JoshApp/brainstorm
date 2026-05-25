import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import type { ModelSpec } from '../ecs/model-types';
import { addItem } from '../player/inventory';

// Pickup interactable: a loot model floating on the floor that the player can
// walk up to and "TAKE." For now, taking it just removes it from the world —
// inventory plumbing comes in the HUD commit. The pickup gently bobs and
// slowly rotates so it reads as an item-of-interest, not set dressing.

const BOB_AMPLITUDE = 0.03;
const BOB_FREQUENCY = 1.8;
const ROTATE_SPEED = 0.5;  // rad/s

export function createPickup(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  model: ModelSpec,
) {
  const built = buildModel(model);
  // Center the item slightly above the floor at the spawn position.
  built.group.position.copy(pos);
  // Lay flat-ish: rotate -90° around X so blade-shape models lie horizontal.
  built.group.rotation.x = -Math.PI / 2;
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
      addItem(model.id);
      interactable.destroyed = true;
    },
    tick(dt: number) {
      t += dt;
      built.group.position.y = baseY + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;
      built.group.rotation.z += ROTATE_SPEED * dt;
    },
    destroyed: false,
    built,
  };
  registerInteractable(interactable);
}
