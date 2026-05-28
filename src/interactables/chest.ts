import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { CHEST, CHEST_IRON, CHEST_BOSS } from '../content/chest';
import type { ItemSpec } from '../content/items';
import { registerInteractable } from './system';
import { createPickup } from './pickup';
import { playChestOpen } from '../audio/sfx';

export type ChestTier = 'supply' | 'iron' | 'boss';

const TIER_MODEL = {
  supply: CHEST,
  iron: CHEST_IRON,
  boss: CHEST_BOSS,
};

// Chest interactable. Two states: closed (default) and open.
//
// On use (when closed):
//   - Set state to opening; animate the lid hinge from 0° to ~110° backwards
//     over ~0.5s.
//   - Once open, spawn a pickup interactable (the loot) beside the chest.
//   - Become inert (can't be used again).

const LID_OPEN_ANGLE = -1.9;   // rad — slightly past vertical so the lid leans back
const OPEN_DURATION = 0.55;    // seconds for the swing-open animation

export function spawnChest(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  loot: ItemSpec | undefined,
  tier: ChestTier = 'supply',
) {
  const built = buildModel(TIER_MODEL[tier]);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  const hinge = built.slots.get('hinge');
  const lootSpawnSlot = built.slots.get('loot_spawn');

  let state: 'closed' | 'opening' | 'open' = 'closed';
  let openTimer = 0;
  const id = generateEntityId('chest');

  const interactable = {
    id,
    position: pos.clone(),
    radius: 1.4,
    promptLabel: 'OPEN',
    onUse() {
      if (state !== 'closed') return;
      state = 'opening';
      openTimer = 0;
      interactable.promptLabel = '';
      playChestOpen();
    },
    tick(dt: number) {
      if (state === 'opening' && hinge) {
        openTimer += dt;
        const t = Math.min(1, openTimer / OPEN_DURATION);
        // Ease-out so the lid slows as it reaches open
        const ease = 1 - (1 - t) * (1 - t);
        hinge.rotation.x = LID_OPEN_ANGLE * ease;
        if (openTimer >= OPEN_DURATION) {
          state = 'open';
          // Spawn loot beside the chest if any was specified.
          if (loot && lootSpawnSlot) {
            const worldPos = new THREE.Vector3();
            lootSpawnSlot.getWorldPosition(worldPos);
            createPickup(scene, worldPos, loot);
          }
        }
      }
    },
    built,
  };
  registerInteractable(interactable);
}
