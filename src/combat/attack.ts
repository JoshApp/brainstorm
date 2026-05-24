import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';

// Combat orchestration. Holds a single raycaster, projects from camera-forward
// during the sword's strike window, and registers damage if any hit-target is
// within sword reach.
//
// One-hit-per-swing: we set a flag at the start of strike and only allow one
// damage event per swing, so the raycaster doesn't tick damage every frame
// of the strike phase.

export interface CombatSystem {
  /** Call once per frame. Triggers attack if input asks for it; resolves hits. */
  tick(attackPressed: boolean): void;
}

export function createCombatSystem(
  camera: THREE.Camera,
  sword: Sword,
  enemies: Enemy[],
): CombatSystem {
  const raycaster = new THREE.Raycaster();
  raycaster.far = CONFIG.SWORD_REACH;

  // Center of screen, normalized device coords
  const center = new THREE.Vector2(0, 0);

  // Has the current strike already registered a hit? Reset at start of each strike.
  let strikeAlreadyHit = false;
  let wasStriking = false;

  function tick(attackPressed: boolean) {
    if (attackPressed) {
      sword.startSwing(); // no-op if already swinging
    }

    const striking = sword.isStriking;

    // Reset hit-flag at the start of each strike phase
    if (striking && !wasStriking) {
      strikeAlreadyHit = false;
    }
    wasStriking = striking;

    if (!striking || strikeAlreadyHit) return;

    // Gather all live hit-targets
    const targets: THREE.Object3D[] = [];
    for (const e of enemies) {
      if (e.alive) targets.push(...e.hitTargets);
    }
    if (targets.length === 0) return;

    raycaster.setFromCamera(center, camera);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;

    // Find which enemy was hit
    const hitObj = hits[0].object;
    for (const e of enemies) {
      if (e.hitTargets.includes(hitObj)) {
        e.takeDamage(1);
        strikeAlreadyHit = true;
        break;
      }
    }
  }

  return { tick };
}
