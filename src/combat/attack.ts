import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import type { Destructible } from '../level/destructibles';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playImpact } from '../audio/sfx';
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
  getDestructibles: () => readonly Destructible[] = () => [],
): CombatSystem {
  let strikeAlreadyHit = false;
  let wasStriking = false;

  function tick(attackPressed: boolean) {
    if (attackPressed) {
      // Whoosh + 'attack:swing' fire from sword.ts's onSwingStart so
      // chained combo steps make sound too, not just the first press.
      // We just forward the input.
      sword.startSwing();
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

    if (!bestEnemy) {
      // No enemy in the swing cone — fall back to destructibles
      // (vases, future breakable props). Same cone + range test;
      // lighter feedback than an enemy hit.
      const destructibles = getDestructibles();
      let bestDest: Destructible | null = null;
      let bestDestSq = reachSq + 1;
      for (const d of destructibles) {
        if (!d.alive) continue;
        const dx = d.position.x - camera.position.x;
        const dy = (d.position.y + 0.25) - camera.position.y;
        const dz = d.position.z - camera.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > reachSq) continue;
        const horDist = Math.hypot(dx, dz);
        if (horDist < 0.0001) {
          if (distSq < bestDestSq) { bestDestSq = distSq; bestDest = d; }
          continue;
        }
        const horDot = (forwardDir.x * dx + forwardDir.z * dz) / (forwardLenXZ * horDist);
        if (horDot < cosConeHalf) continue;
        if (distSq < bestDestSq) { bestDestSq = distSq; bestDest = d; }
      }
      if (bestDest) {
        bestDest.takeDamage(getCurrentWeapon().damage, hitPoint);
        strikeAlreadyHit = true;
        // Lighter crunch than an enemy hit — the vase shatters,
        // it doesn't fight back.
        freezeFor(Math.min(40, CONFIG.HIT_PAUSE_MS * 0.4));
        kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 0.4, CONFIG.SCREEN_SHAKE_HIT_DURATION * 0.5);
        hapticVibrate(CONFIG.HAPTIC_HIT_MS / 2);
        playImpact();
      }
      return;
    }

    // Crit roll — decided BEFORE the damage pipeline so the pipeline's
    // input damage already reflects the multiplier. critChance/Mult on
    // WeaponStats default to 5% / 2x.
    const critChance = weapon.critChance ?? 0;
    const critMult   = weapon.critMultiplier ?? 2.0;
    const crit = Math.random() < critChance;
    const baseDamage = crit ? weapon.damage * critMult : weapon.damage;

    // Route through the damage pipeline. The pipeline applies the player's
    // equipment damage bonus (Ring of Predation +1, etc.) from the source
    // stats, then the enemy's physical armor from the target stats. Player
    // attacks default to PHYSICAL until we add a wand / spell.
    const applied = bestEnemy.takeDamage({
      source: 'player',
      target: bestEnemy.entityId,
      base: baseDamage,
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
    // Crits get a beefier hit-pause + shake to sell the heavier blow.
    const crunchPause = crit ? CONFIG.HIT_PAUSE_MS + 60 : CONFIG.HIT_PAUSE_MS;
    const crunchShake = crit
      ? CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 1.8
      : CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE;
    freezeFor(crunchPause);
    kickShake(crunchShake, CONFIG.SCREEN_SHAKE_HIT_DURATION);
    hapticVibrate(crit ? CONFIG.HAPTIC_HIT_MS * 2 : CONFIG.HAPTIC_HIT_MS);
    playImpact();
    spawnDamageNumber(camera, hitPoint, applied, crit);
    emit({ type: 'attack:hit', damage: applied, crit, cls: weapon.class });
  }

  return { tick };
}
