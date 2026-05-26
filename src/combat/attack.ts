import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playWhoosh, playImpact } from '../audio/sfx';
import { spawnDamageNumber } from '../ui/damage-numbers';
import { emit } from '../broadcast/event-bus';
import { getCurrentWeapon } from '../player/current-weapon';

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
const hitPoint = new THREE.Vector3();

export function createCombatSystem(
  camera: THREE.Camera,
  sword: Sword,
  getEnemies: () => readonly Enemy[],
): CombatSystem {
  let strikeAlreadyHit = false;
  let wasStriking = false;

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
    // Pull stats from the currently-equipped weapon (different weapons have
    // different reach + arc + damage).
    const weapon = getCurrentWeapon();
    const reachSq = weapon.reach * weapon.reach;
    const cosConeHalf = Math.cos(weapon.coneHalfAngle);

    // Cone check runs in the HORIZONTAL plane only. A 3D check breaks at
    // very close range: when a tall enemy (e.g. wraith) is pressed against
    // the player, the toEnemy vector points mostly downward, so its dot
    // with the roughly-horizontal forward dir drops below cosConeHalf and
    // the swing whiffs even though the enemy is right in your face. The
    // reach check still uses 3D distance, so you can still hit a rat at
    // your feet by looking down.
    const forwardLenXZ = Math.hypot(forwardDir.x, forwardDir.z) || 1;

    let bestEnemy: Enemy | null = null;
    let bestDistSq = reachSq + 1;
    const enemies = getEnemies();
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - camera.position.x;
      const dy = (e.group.position.y + 0.6) - camera.position.y;
      const dz = e.group.position.z - camera.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > reachSq) continue;

      const horDist = Math.hypot(dx, dz);
      // Degenerate case: enemy directly on top of the player (no horizontal
      // displacement at all). Always counts as in-cone — you can't NOT face
      // something inside you.
      if (horDist < 0.0001) {
        if (distSq < bestDistSq) { bestDistSq = distSq; bestEnemy = e; }
        continue;
      }
      const horDot = (forwardDir.x * dx + forwardDir.z * dz) / (forwardLenXZ * horDist);
      if (horDot < cosConeHalf) continue;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestEnemy = e;
      }
    }

    if (!bestEnemy) return;

    // Route through the damage pipeline. The pipeline applies the player's
    // equipment damage bonus (Ring of Predation +1, etc.) from the source
    // stats, then the enemy's physical armor from the target stats. Player
    // attacks default to PHYSICAL until we add a wand / spell.
    const applied = bestEnemy.takeDamage({
      source: 'player',
      target: bestEnemy.entityId,
      base: weapon.damage,
      type: 'physical',
    });
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
    spawnDamageNumber(camera, hitPoint, applied);
    emit({ type: 'attack:hit', damage: applied });
  }

  return { tick };
}
