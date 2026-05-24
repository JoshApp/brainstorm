import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playWhoosh, playImpact } from '../audio/sfx';
import { spawnDamageNumber } from '../ui/damage-numbers';

// Combat orchestration. Holds a single raycaster, projects from camera-forward
// during the sword's strike window, and registers damage if any hit-target is
// within sword reach. On hit, fires the full crunch stack: hit-pause, screen
// shake, haptic, impact sound, damage number.
//
// One-hit-per-swing: we set a flag at the start of strike and only allow one
// damage event per swing, so the raycaster doesn't tick damage every frame
// of the strike phase.

export interface CombatSystem {
  /** Call once per frame. Triggers attack if input asks for it; resolves hits. */
  tick(attackPressed: boolean): void;
}

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
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
      const started = sword.startSwing();
      if (started) playWhoosh();
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
    const hitPoint = hits[0].point;
    for (const e of enemies) {
      if (e.hitTargets.includes(hitObj)) {
        const damage = 1;
        e.takeDamage(damage);
        strikeAlreadyHit = true;

        // --- THE CRUNCH ---
        freezeFor(CONFIG.HIT_PAUSE_MS);
        kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE, CONFIG.SCREEN_SHAKE_HIT_DURATION);
        hapticVibrate(CONFIG.HAPTIC_HIT_MS);
        playImpact();
        spawnDamageNumber(camera, hitPoint, damage);
        break;
      }
    }
  }

  return { tick };
}
