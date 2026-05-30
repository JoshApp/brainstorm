import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Sword } from '../player/sword';
import type { Enemy } from '../mobs/enemy';
import type { Destructible } from '../level/destructibles';
import type { Damageable } from './damageable';
import { freezeFor } from './hit-pause';
import { kickShake } from './screen-shake';
import { playImpact, playWhoosh } from '../audio/sfx';
import { spawnDamageNumber } from '../ui/damage-numbers';
import { emit } from '../broadcast/event-bus';
import { getCurrentWeapon } from '../player/current-weapon';
import { getPlayerOnHits } from '../player/equipment';
import type { ResolvedWeaponStats } from '../content/weapon-classes';
import { computePlayerStats } from './modifiers';
import { gameRngChance } from '../engine/rng';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { spawnProjectile, setProjectileEnemyProvider } from './projectile-pool';
import { getEquipped } from '../player/equipment';

// Combat orchestration. During the sword's strike window, scans all live
// enemies for any within a FORWARD CONE of the camera (range = SWORD_REACH,
// half-angle = SWORD_CONE_HALF_ANGLE). The cone is wide enough that the
// player doesn't have to aim precisely — facing the enemy roughly is enough,
// including looking DOWN at small floor-level mobs like rats.
//
// One-hit-per-swing: flag set at start of strike phase, cleared on the next
// strike. Picks the closest enemy in the cone, not the first.
//
// Strike-window trail: after the strike phase ENDS, the cone-test keeps
// running for STRIKE_TRAIL_DURATION more seconds (if we haven't hit yet).
// Gives the player a small forgiveness tail — close-call timings where
// the swing felt right but the enemy was just outside reach during the
// 100ms strike now connect. Doesn't extend the animation or let you
// double-tap faster; only opens if no hit landed during strike.

const STRIKE_TRAIL_DURATION = 0.10;     // seconds — Smash-Bros-style intent buffer

export interface CombatSystem {
  tick(attackPressed: boolean, dt: number): void;
}

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

// Reusable scratch vectors.
const forwardDir = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpAim = new THREE.Vector3();

// Ranged auto-aim — generous so the player never has to aim precisely
// (one-thumb). Long reach + a wide cone; the nearest in-arc enemy is the
// shot's target.
const RANGED_REACH = 16;
const RANGED_CONE_COS = Math.cos(0.6);   // ~34° half-angle auto-aim arc

export function createCombatSystem(
  camera: THREE.Camera,
  sword: Sword,
  getEnemies: () => readonly Enemy[],
  getDestructibles: () => readonly Destructible[] = () => [],
): CombatSystem {
  let strikeAlreadyHit = false;
  let wasStriking = false;
  let trailTimer = 0;     // > 0 → strike-trail hit window is open

  // Friendly projectiles (crossbow/wand) hit-test enemies via this
  // provider — registered here so the projectile pool's tick needn't
  // take an extra arg (keeps the main-loop call site untouched).
  setProjectileEnemyProvider(getEnemies);

  /** Fire the equipped ranged weapon's projectile at the auto-target
   *  (nearest enemy in the forward arc) or straight ahead if none. */
  function fireRanged(weapon: ResolvedWeaponStats) {
    if (!weapon.ranged) return;
    const target = pickTarget(getEnemies(), camera, forwardDir, Math.hypot(forwardDir.x, forwardDir.z) || 1, RANGED_REACH * RANGED_REACH, RANGED_CONE_COS);
    // Muzzle just in front of + below the camera so the bolt reads as
    // leaving the weapon, not the eye.
    tmpMuzzle.copy(camera.position).addScaledVector(forwardDir, 0.5);
    tmpMuzzle.y -= 0.15;
    if (target) {
      tmpAim.set(target.position.x, target.position.y + target.aimHeight, target.position.z);
    } else {
      tmpAim.copy(camera.position).addScaledVector(forwardDir, RANGED_REACH);
    }
    const crit = gameRngChance(weapon.critChance ?? 0);
    const dmg = crit ? weapon.damage * (weapon.critMultiplier ?? 2) : weapon.damage;
    spawnProjectile({
      typeId: weapon.ranged.projectileId,
      origin: tmpMuzzle,
      target: tmpAim,
      damage: dmg,
      source: 'player',
      friendly: true,
      // Carry the player's on-hit statuses onto the bolt so a ranged
      // weapon's base on-hit (the wand's chill) + on-hit affixes + set
      // bonuses all land when it strikes an enemy — same rules as melee.
      onHits: getPlayerOnHits(),
    });
    playWhoosh();
    hapticVibrate(CONFIG.HAPTIC_HIT_MS / 2);

    // Fire punch — a camera kick on release so the shot has weight. The
    // crossbow's mechanical release hits harder (heftier kick + a tiny
    // hit-pause "thunk"); the wand's cast is a lighter shove. This is the
    // viewmodel recoil's screen-space counterpart.
    const heavy = weapon.class === 'crossbow';
    kickShake(
      CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * (heavy ? 0.7 : 0.4),
      CONFIG.SCREEN_SHAKE_HIT_DURATION * 0.6,
    );
    if (heavy) freezeFor(Math.min(30, CONFIG.HIT_PAUSE_MS * 0.3));
  }

  function tick(attackPressed: boolean, dt: number) {
    if (attackPressed) {
      // Gate: if nothing is equipped in the weapon slot, swallow the
      // press silently. Avoids the bare-hands attack sound + the
      // viewmodel-less swing animation that fires when the player
      // hasn't picked up a weapon yet.
      if (!getEquipped('weapon')) {
        return;
      }
      // Whoosh + 'attack:swing' fire from sword.ts's onSwingStart so
      // chained combo steps make sound too, not just the first press.
      // We just forward the input.
      sword.startSwing();
    }

    const striking = sword.isStriking;

    if (striking && !wasStriking) {
      strikeAlreadyHit = false;
      trailTimer = 0;
    }
    // Strike phase just ended without a hit → open the trail window.
    if (wasStriking && !striking && !strikeAlreadyHit) {
      trailTimer = STRIKE_TRAIL_DURATION;
    }
    wasStriking = striking;

    // Hit-test runs during strike OR during the trail tail (if we
    // haven't connected yet). Once strikeAlreadyHit is true, both
    // windows close until the next swing.
    const inHitWindow = (striking || trailTimer > 0) && !strikeAlreadyHit;
    if (trailTimer > 0) trailTimer = Math.max(0, trailTimer - dt);
    if (!inHitWindow) return;

    camera.getWorldDirection(forwardDir);  // unit vector
    // Pull stats from the currently-equipped weapon (different weapons have
    // different reach + arc + damage).
    const weapon = getCurrentWeapon();
    const reachSq = weapon.reach * weapon.reach;
    const cosConeHalf = Math.cos(weapon.coneHalfAngle);

    // RANGED branch — a crossbow/wand FIRES a projectile at the auto-
    // target instead of doing a melee cone hit. One shot per strike
    // (strikeAlreadyHit), the weapon's slow recover IS the reload.
    if (weapon.ranged) {
      fireRanged(weapon);
      strikeAlreadyHit = true;
      return;
    }

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

    // On-hit status — every source the player carries (weapon base
    // on-hit + on-hit affixes rolled on the weapon + active set on-hits)
    // rolls independently against the struck enemy. So a serrated,
    // venom-etched needle in the bone set can bleed AND poison AND
    // set-poison off one hit. Stacking statuses (bleed/poison) build per
    // hit, so a fast weapon ramps them. Heavy targets only — an urn
    // doesn't bleed.
    if (target.hitFeedback === 'heavy') {
      const ent = getEntity(target.entityId);
      if (ent) {
        for (const oh of getPlayerOnHits()) {
          if (gameRngChance(oh.chance)) applyBuff(ent, oh.buffId, oh.duration, 'player');
        }
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
