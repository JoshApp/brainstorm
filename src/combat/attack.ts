import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import type { Destructible } from '../level/destructibles';
import type { Damageable } from './damageable';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playImpact } from '../audio/sfx';
import { spawnDamageNumber } from '../ui/damage-numbers';
import { emit } from '../broadcast/event-bus';
import { getCurrentWeapon } from '../player/current-weapon';
import { computePlayerStats } from './modifiers';
import { gameRngChance } from '../engine/rng';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';

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

    // ONE cone scan over a uniform Damageable shape (enemies + destructible
    // props both implement it). Enemies take priority: a vase shouldn't soak
    // a swing meant for the mob behind it, so we only fall back to props when
    // no enemy is in the cone. Each list shares the same picker below.
    const target =
      pickTarget(getEnemies(), camera, forwardDir, forwardLenXZ, reachSq, cosConeHalf) ??
      pickTarget(getDestructibles(), camera, forwardDir, forwardLenXZ, reachSq, cosConeHalf);
    if (!target) return;

    // Crit roll — decided BEFORE the damage pipeline so the pipeline's
    // input damage already reflects the multiplier. critChance/Mult on
    // WeaponStats default to 5% / 2x.
    const critChance = weapon.critChance ?? 0;
    const critMult   = weapon.critMultiplier ?? 2.0;
    const crit = gameRngChance(critChance);
    // Finisher bonus: if this strike is the LAST step of the combo
    // and the player has any items with 'finisher-damage-mult'
    // modifiers, fold their compound multiplier into the base.
    // Pre-pipeline so the resulting damage still gets equipment
    // damage bonuses + targets armor as usual.
    const finisherMult = sword.isFinisherStrike
      ? computePlayerStats().finisherDamageMultiplier
      : 1;
    const baseDamage = (crit ? weapon.damage * critMult : weapon.damage) * finisherMult;

    // Route through the damage pipeline. The pipeline applies the player's
    // equipment damage bonus (Ring of Predation +1, etc.) from the source
    // stats, then the target's physical armor (0 for props) from the target
    // stats. Player attacks default to PHYSICAL until we add a wand / spell.
    const applied = target.takeDamage({
      source: 'player',
      target: target.entityId,
      base: baseDamage,
      type: 'physical',
    });
    strikeAlreadyHit = true;

    // Damage number floats from the target's aim point.
    hitPoint.set(target.position.x, target.position.y + target.aimHeight, target.position.z);
    if (applied > 0) spawnDamageNumber(camera, hitPoint, applied, crit);

    // On-hit status — a serrated/venomed weapon applies its status to the
    // struck enemy. Stacking statuses (bleed/poison) build per hit, so a
    // fast weapon ramps them. Only on "heavy" targets (enemies), never
    // props — an urn doesn't bleed.
    if (weapon.onHit && target.hitFeedback === 'heavy') {
      const oh = weapon.onHit;
      if (gameRngChance(oh.chance)) {
        const ent = getEntity(target.entityId);
        if (ent) applyBuff(ent, oh.buffId, oh.duration, 'player');
      }
    }

    // --- THE CRUNCH ---
    // Heavy targets (mobs) get the full hit-pause + shake + on-hit passives;
    // crits beef it up further. Light targets (vases) get a token crunch —
    // they shatter, they don't fight back — and never fire on-hit passives
    // (no lifesteal off an urn).
    if (target.hitFeedback === 'heavy') {
      const crunchPause = crit ? CONFIG.HIT_PAUSE_MS + 60 : CONFIG.HIT_PAUSE_MS;
      const crunchShake = crit
        ? CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 1.8
        : CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE;
      freezeFor(crunchPause);
      kickShake(crunchShake, CONFIG.SCREEN_SHAKE_HIT_DURATION);
      hapticVibrate(crit ? CONFIG.HAPTIC_HIT_MS * 2 : CONFIG.HAPTIC_HIT_MS);
      playImpact();
      emit({ type: 'attack:hit', damage: applied, crit, cls: weapon.class });
    } else {
      freezeFor(Math.min(40, CONFIG.HIT_PAUSE_MS * 0.4));
      kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 0.4, CONFIG.SCREEN_SHAKE_HIT_DURATION * 0.5);
      hapticVibrate(CONFIG.HAPTIC_HIT_MS / 2);
      playImpact();
    }
  }

  return { tick };
}

/**
 * Pick the closest live target inside the swing cone. Shared by enemies and
 * destructibles — both are Damageable.
 *
 * Cone check runs in the HORIZONTAL plane only. A 3D check breaks at very
 * close range: when a tall enemy (e.g. wraith) is pressed against the player,
 * the to-target vector points mostly downward, so its dot with the roughly-
 * horizontal forward dir drops below cosConeHalf and the swing whiffs even
 * though the target is right in your face. The reach check still uses 3D
 * distance, so you can still hit a rat at your feet by looking down.
 */
// Horizontal distance under which a target is treated as "in your
// face" and always inside the swing cone (see pickTarget). ~0.9m so an
// adjacent or overlapping enemy is reliably hittable.
const POINT_BLANK_RADIUS = 0.9;

function pickTarget<T extends Damageable>(
  targets: readonly T[],
  camera: THREE.Camera,
  forwardDir: THREE.Vector3,
  forwardLenXZ: number,
  reachSq: number,
  cosConeHalf: number,
): T | null {
  let best: T | null = null;
  let bestDistSq = reachSq + 1;
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.position.x - camera.position.x;
    const dy = (t.position.y + t.aimHeight) - camera.position.y;
    const dz = t.position.z - camera.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > reachSq) continue;

    const horDist = Math.hypot(dx, dz);
    // Point-blank: a target pressed against (or inside) you is ALWAYS
    // hittable, regardless of facing — you'd flail at something that
    // close. Covers both the exact-overlap degenerate case and the
    // "enemy ended up adjacent / slightly behind" case (e.g. after a
    // charge), which the cone check would otherwise whiff. Without this,
    // an enemy stuck on top of you is weirdly hard to hit.
    if (horDist < POINT_BLANK_RADIUS) {
      if (distSq < bestDistSq) { bestDistSq = distSq; best = t; }
      continue;
    }
    const horDot = (forwardDir.x * dx + forwardDir.z * dz) / (forwardLenXZ * horDist);
    if (horDot < cosConeHalf) continue;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = t;
    }
  }
  return best;
}
