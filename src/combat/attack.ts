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
import { consumeChargedAmount } from '../controls/charge-input';
import type { AttackDirection } from '../player/sword';

// Joystick magnitude below this counts as "not moving" → no
// directional override. Tuned so a tiny accidental thumb shift on
// the joystick doesn't pull the player into an unintended sweep.
const MOVE_INTENT_THRESHOLD = 0.35;
// How much more lateral than forward/back the joystick needs to be
// before "strafe" wins over "forward/back." Below 1.0 means lateral
// reads even on near-diagonal — strafe is hard to commit to fully
// during combat-pressure thumb movement.
const STRAFE_AXIS_BIAS = 0.7;

/** Picks an attack direction from the live joystick state at the
 *  moment of a press. Returns null if the joystick isn't held past
 *  the intent threshold — caller should fire a neutral combo step. */
function pickAttackDirection(moveX: number, moveY: number): AttackDirection {
  const mag = Math.hypot(moveX, moveY);
  if (mag < MOVE_INTENT_THRESHOLD) return null;
  // Lateral wins on near-diagonals (STRAFE_AXIS_BIAS < 1).
  if (Math.abs(moveX) > Math.abs(moveY) * STRAFE_AXIS_BIAS) return 'strafe';
  // moveY < 0 in joystick convention means UP — the player is
  // pushing FORWARD relative to where the camera is facing.
  return moveY < 0 ? 'forward' : 'back';
}

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
  tick(attackPressed: boolean, moveX: number, moveY: number, dt: number): void;
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
  // Charge level 0..1 captured at attackPressed time; read by the
  // strike resolution to scale damage / reach / cone. Reset on each
  // new press (taps reset it to 0, charged swings to their progress).
  let currentSwingCharge = 0;

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
      // Horizontal auto-aim (XZ to the target), but the player
      // controls the VERTICAL — the bolt's elevation comes from
      // the camera's pitch projected to the target's horizontal
      // distance. Looking up shoots over / at the head; looking
      // down lands at the feet. Previous version forced y to the
      // target's torso aimHeight which felt like the player was
      // shooting at feet regardless of where they aimed.
      const dx = target.position.x - camera.position.x;
      const dz = target.position.z - camera.position.z;
      const horDist = Math.hypot(dx, dz) || 0.001;
      const fLatLen = Math.hypot(forwardDir.x, forwardDir.z) || 0.001;
      const pitchTan = forwardDir.y / fLatLen;
      tmpAim.set(
        target.position.x,
        camera.position.y + pitchTan * horDist,
        target.position.z,
      );
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

  function tick(attackPressed: boolean, moveX: number, moveY: number, dt: number) {
    if (attackPressed) {
      // Gate: if nothing is equipped in the weapon slot, swallow the
      // press silently. Avoids the bare-hands attack sound + the
      // viewmodel-less swing animation that fires when the player
      // hasn't picked up a weapon yet.
      if (!getEquipped('weapon')) {
        return;
      }
      // Capture any pending charge for this swing — 0 if it was a
      // tap, 0..1 if the player held to charge. The strike-phase
      // resolution below reads currentSwingCharge to scale damage,
      // reach, and cone width. Reset per-press, so chained tap-combos
      // reset back to 0 naturally on the next press.
      currentSwingCharge = consumeChargedAmount();
      // Movement intent at press time. Picks a directional move
      // override (lunge / sweep / retreat) when the joystick is
      // held — null otherwise (= normal combo step). The sword
      // class spec decides whether a directional move is registered.
      const direction = pickAttackDirection(moveX, moveY);
      // Whoosh + 'attack:swing' fire from sword.ts's onSwingStart so
      // chained combo steps make sound too, not just the first press.
      // Charged releases SKIP the windup phase — the player paid for
      // it by holding; the viewmodel's cocked-back idle pose blends
      // continuously into the strike's t=0 pose so the swing reads as
      // "held back, now released" rather than "extra windup."
      sword.startSwing({ skipWindup: currentSwingCharge > 0, direction });
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
    const weapon = getCurrentWeapon();

    // RANGED branch — a crossbow/wand FIRES a projectile at the auto-
    // target instead of doing a melee cone hit. One shot per strike
    // (strikeAlreadyHit), the weapon's slow recover IS the reload.
    if (weapon.ranged) {
      fireRanged(weapon);
      strikeAlreadyHit = true;
      return;
    }

    // Per-combo-step reach + cone + multi-target. The active step's
    // reachMul / coneHalfAngleMul / maxTargets layer over the weapon's
    // base stats so each combo position has its own character:
    // sword's slashes cleave 2 at standard reach, thrust finisher
    // extends and narrows; hammer smash cleaves 3 with wider arc.
    //
    // Hold-to-charge (sword prototype): a fully charged swing extends
    // reach by 30%, widens the cone by 40%, and adds up to one extra
    // multi-target slot for a more sweeping cleave. Damage scaling
    // happens further down at the per-target damage calculation.
    const step = sword.getActiveStep();
    const c = currentSwingCharge;
    const reach = weapon.reach * (step?.reachMul ?? 1) * (1 + c * 0.30);
    const reachSq = reach * reach;
    const cosConeHalf = Math.cos(weapon.coneHalfAngle * (step?.coneHalfAngleMul ?? 1) * (1 + c * 0.40));
    const maxTargets = (step?.maxTargets ?? 1) + (c >= 0.7 ? 1 : 0);

    // Cone check runs in the HORIZONTAL plane only. A 3D check breaks at
    // very close range: when a tall enemy (e.g. wraith) is pressed against
    // the player, the toEnemy vector points mostly downward, so its dot
    // with the roughly-horizontal forward dir drops below cosConeHalf and
    // the swing whiffs even though the enemy is right in your face. The
    // reach check still uses 3D distance, so you can still hit a rat at
    // your feet by looking down.
    const forwardLenXZ = Math.hypot(forwardDir.x, forwardDir.z) || 1;

    // Multi-target cone scan. Enemies take priority; props only fall
    // through when no enemies are in the cone (a vase shouldn't soak
    // a swing meant for the mob behind it).
    const enemyHits = pickTargets(getEnemies(), camera, forwardDir, forwardLenXZ, reachSq, cosConeHalf, maxTargets);
    const targets = enemyHits.length > 0
      ? enemyHits
      : pickTargets(getDestructibles(), camera, forwardDir, forwardLenXZ, reachSq, cosConeHalf, maxTargets);
    if (targets.length === 0) return;

    strikeAlreadyHit = true;

    // Crit per-hit so a 3-target sweep can crit one and not the
    // others — feels better than one roll applying to the whole arc.
    const critChance = weapon.critChance ?? 0;
    const critMult   = weapon.critMultiplier ?? 2.0;
    const finisherMult = sword.isFinisherStrike
      ? computePlayerStats().finisherDamageMultiplier
      : 1;

    // Charged-swing damage multiplier — fully charged ×1.8, ramps
    // linearly from charge progress (c).
    const chargeDamageMul = 1 + c * 0.80;

    let anyCrit = false;
    let bestApplied = 0;
    let anyHeavy = false;
    for (const target of targets) {
      const crit = gameRngChance(critChance);
      const baseDamage = (crit ? weapon.damage * critMult : weapon.damage) * finisherMult * chargeDamageMul;
      const applied = target.takeDamage({
        source: 'player',
        target: target.entityId,
        base: baseDamage,
        type: 'physical',
      });

      // Damage number floats from this target's aim point.
      hitPoint.set(target.position.x, target.position.y + target.aimHeight, target.position.z);
      if (applied > 0) spawnDamageNumber(camera, hitPoint, applied, crit);

      // On-hit statuses roll per-target on heavies (mobs) — vases
      // don't bleed.
      if (target.hitFeedback === 'heavy') {
        anyHeavy = true;
        const ent = getEntity(target.entityId);
        if (ent) {
          for (const oh of getPlayerOnHits()) {
            if (gameRngChance(oh.chance)) applyBuff(ent, oh.buffId, oh.duration, 'player');
          }
        }
        emit({ type: 'attack:hit', damage: applied, crit, cls: weapon.class });
      }
      if (crit) anyCrit = true;
      if (applied > bestApplied) bestApplied = applied;
    }

    // --- THE CRUNCH ---
    // One hit-pause + shake per swing regardless of target count —
    // stacking N freezes for an N-cleave would feel terrible. Use
    // the best-hit's stats (any-crit, any-heavy) so a cleave that
    // crit-killed a mob and grazed a vase still gets the full crunch.
    // Impact sound plays at the CLOSEST target's position — gives the
    // hit a directional sense (pans + room reverb tail) instead of a
    // flat dry thud at the listener.
    const impactAt = targets[0].position;
    if (anyHeavy) {
      const crunchPause = anyCrit ? CONFIG.HIT_PAUSE_MS + 60 : CONFIG.HIT_PAUSE_MS;
      const crunchShake = anyCrit
        ? CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 1.8
        : CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE;
      freezeFor(crunchPause);
      kickShake(crunchShake, CONFIG.SCREEN_SHAKE_HIT_DURATION);
      hapticVibrate(anyCrit ? CONFIG.HAPTIC_HIT_MS * 2 : CONFIG.HAPTIC_HIT_MS);
      playImpact(impactAt);
    } else {
      // Light targets only (vases) — token crunch, no on-hit passives.
      freezeFor(Math.min(40, CONFIG.HIT_PAUSE_MS * 0.4));
      kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 0.4, CONFIG.SCREEN_SHAKE_HIT_DURATION * 0.5);
      hapticVibrate(CONFIG.HAPTIC_HIT_MS / 2);
      playImpact(impactAt);
    }
    void bestApplied;   // reserved for future "biggest hit wins crunch tier"
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

/** Multi-target variant — returns up to `maxTargets` in-cone targets,
 *  nearest first. Used by combo steps that cleave (sword slash, hammer
 *  smash). Single-target callers pass maxTargets=1 and unwrap [0]. */
function pickTargets<T extends Damageable>(
  targets: readonly T[],
  camera: THREE.Camera,
  forwardDir: THREE.Vector3,
  forwardLenXZ: number,
  reachSq: number,
  cosConeHalf: number,
  maxTargets: number,
): T[] {
  if (maxTargets <= 1) {
    const single = pickTarget(targets, camera, forwardDir, forwardLenXZ, reachSq, cosConeHalf);
    return single ? [single] : [];
  }
  // Collect all in-cone targets with distance, then sort + cap.
  const hits: Array<{ t: T; d2: number }> = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.position.x - camera.position.x;
    const dy = (t.position.y + t.aimHeight) - camera.position.y;
    const dz = t.position.z - camera.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > reachSq) continue;
    const horDist = Math.hypot(dx, dz);
    if (horDist < POINT_BLANK_RADIUS) {
      hits.push({ t, d2: distSq });
      continue;
    }
    const horDot = (forwardDir.x * dx + forwardDir.z * dz) / (forwardLenXZ * horDist);
    if (horDot < cosConeHalf) continue;
    hits.push({ t, d2: distSq });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  return hits.slice(0, maxTargets).map((h) => h.t);
}

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
