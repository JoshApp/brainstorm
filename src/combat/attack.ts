import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playWhoosh, playImpact } from '../audio/sfx';
import { spawnDamageNumber } from '../ui/damage-numbers';
import { emit } from '../broadcast/event-bus';

// Combat orchestration. During the sword's strike window, scans all live
// enemies for any within a FORWARD CONE of the camera (range = SWORD_REACH,
// half-angle = SWORD_CONE_HALF_ANGLE). The cone is wide enough that the
// player doesn't have to aim precisely — facing the enemy roughly is enough,
// including looking DOWN at small floor-level mobs like rats.
//
// One-hit-per-swing: flag set at start of strike phase, cleared on the next
// strike. Picks the closest enemy in the cone, not the first.

export interface CombatSystem {
  tick(attackPressed: boolean): void;
}

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

// Reusable scratch vectors.
const forwardDir = new THREE.Vector3();
const toEnemy = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

export function createCombatSystem(
  camera: THREE.Camera,
  sword: Sword,
  enemies: Enemy[],
): CombatSystem {
  let strikeAlreadyHit = false;
  let wasStriking = false;

  // Pre-compute cos(half-angle) for cheap dot-product comparison
  const cosConeHalf = Math.cos(CONFIG.SWORD_CONE_HALF_ANGLE);

  function tick(attackPressed: boolean) {
    if (attackPressed) {
      const started = sword.startSwing();
      if (started) {
        playWhoosh();
        emit({ type: 'attack:swing' });
      }
    }

    const striking = sword.isStriking;

    if (striking && !wasStriking) {
      strikeAlreadyHit = false;
    }
    wasStriking = striking;

    if (!striking || strikeAlreadyHit) return;

    camera.getWorldDirection(forwardDir);  // unit vector
    const reachSq = CONFIG.SWORD_REACH * CONFIG.SWORD_REACH;

    let bestEnemy: Enemy | null = null;
    let bestDistSq = reachSq + 1;
    for (const e of enemies) {
      if (!e.alive) continue;

      // Use the enemy's group origin (floor level) as the reference point,
      // but raise by the enemy's "torso center" for a more natural target.
      // The simple group position works fine since the cone is generous.
      toEnemy.set(
        e.group.position.x - camera.position.x,
        (e.group.position.y + 0.6) - camera.position.y,  // chest height target
        e.group.position.z - camera.position.z,
      );
      const distSq = toEnemy.lengthSq();
      if (distSq > reachSq) continue;

      const dist = Math.sqrt(distSq);
      // Cheap cone check: dot(forward, toEnemyDir) > cos(half-angle)
      const dot = (forwardDir.x * toEnemy.x + forwardDir.y * toEnemy.y + forwardDir.z * toEnemy.z) / dist;
      if (dot < cosConeHalf) continue;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestEnemy = e;
      }
    }

    if (!bestEnemy) return;

    const damage = 1;
    bestEnemy.takeDamage(damage);
    strikeAlreadyHit = true;

    // Damage number floats from the enemy's apparent location (torso height).
    hitPoint.set(
      bestEnemy.group.position.x,
      bestEnemy.group.position.y + 0.9,
      bestEnemy.group.position.z,
    );

    // --- THE CRUNCH ---
    freezeFor(CONFIG.HIT_PAUSE_MS);
    kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE, CONFIG.SCREEN_SHAKE_HIT_DURATION);
    hapticVibrate(CONFIG.HAPTIC_HIT_MS);
    playImpact();
    spawnDamageNumber(camera, hitPoint, damage);
    emit({ type: 'attack:hit', damage });
  }

  return { tick };
}
