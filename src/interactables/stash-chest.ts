import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { buildModel } from '../ecs/build-model';
import { CHEST } from '../content/chest';
import { showStash } from '../ui/stash-screen';
import { playChestOpen } from '../audio/sfx';

// Stash chest — lives in the safe room. Diegetic entry point to the
// meta-progression stash UI (loot boxes from previous runs). Reuses
// the standard chest model; on interact, opens the stash overlay
// instead of dropping an item.
//
// Tapping the chest while the stash is empty still plays the open
// animation so the action feels acknowledged; the stash screen itself
// handles the "no boxes here" case.

const OPEN_DURATION = 0.6;
const HINGE_AXIS_X = -Math.PI / 2.4;

export function spawnStashChest(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
) {
  const built = buildModel(CHEST);
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  scene.add(built.group);

  const hinge = built.slots.get('hinge');

  let state: 'closed' | 'opening' | 'open' = 'closed';
  let openTimer = 0;

  const interactable = {
    id: generateEntityId('stash-chest'),
    position: pos.clone(),
    radius: 1.5,
    promptLabel: 'OPEN STASH',
    nameLabel: 'STASH',
    onUse() {
      // First-tap: play the open animation. Subsequent taps reopen
      // the UI without re-animating.
      if (state === 'closed') {
        state = 'opening';
        openTimer = 0;
        playChestOpen();
      }
      showStash();
    },
    tick(dt: number) {
      if (state === 'opening' && hinge) {
        openTimer += dt;
        const t = Math.min(1, openTimer / OPEN_DURATION);
        const e = 1 - Math.pow(1 - t, 3);   // ease-out cubic
        hinge.rotation.x = HINGE_AXIS_X * e;
        if (t >= 1) state = 'open';
      }
    },
    destroyed: false,
    built,
  };
  registerInteractable(interactable);
}
