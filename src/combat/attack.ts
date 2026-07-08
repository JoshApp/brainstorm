import * as THREE from 'three';
import { CONFIG } from '../config';
import type { WeaponViewmodel } from '../player/viewmodel';
import type { Enemy } from '../mobs/enemy';
import type { Destructible } from '../level/destructibles';
import type { Damageable } from './damageable';
import { freezeFor } from './hit-pause';
import { emitGoreSplash } from '../scene/splat-map';
import { kickShake } from './screen-shake';
import { playImpact, playWhoosh, playBuffApply, playSurfaceHit } from '../audio/sfx';
import { applyViewmodelKickback } from '../player/viewmodel-pullback';
import { spawnDamageNumber, spawnStatusText } from '../ui/damage-numbers';
import { emit, on } from '../broadcast/event-bus';
import { getCurrentWeapon } from '../player/current-weapon';
import { getPlayerOnHits } from '../player/equipment';
import type { ResolvedWeaponStats } from '../content/weapon-classes';
import { computePlayerStats } from './modifiers';
import { gameRngChance, gameRng } from '../engine/rng';
import { get as getEntity } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { registerDeathPayoff } from './death-payoffs';
import { setMoveIntent } from '../player/move-intent';
import { spawnProjectile, setProjectileEnemyProvider, setProjectileDestructibleProvider } from './projectile-pool';
import { getEquipped } from '../player/equipment';
import { healPlayer } from '../player/health';
import { consumeChargedAmount, consumeChargedPerfect, getChargeProgress, setChargeDirection } from '../controls/charge-input';
import { spendStaminaSoft, gainStamina } from './stamina';
import { isJustDodgeCounterActive, consumeJustDodgeCounter } from './just-dodge';
import { isDeflectEmpowerActive, consumeDeflectEmpower } from './reactive-defense';
import { fireCombatVerb } from './combat-verbs';
import { canStartAction } from './player-action';
import { flashStaminaBar } from '../ui/stamina-bar';
import { showHitCones, markSwingHits, type SwingShape } from './combat-debug';
import { resolveWorldZones, testSegmentZones, type WorldZone, type ZoneHit } from './hurtbox';
import type { AttackDirection } from '../player/viewmodel';

/** Bill a melee swing's stamina — called once per ACTUAL swing from the
 *  viewmodel's onSwingStart (initial press AND every buffered combo step), so
 *  drain is bound to swings, not button taps. Mashing faster than the animation
 *  buffers and pays only per real swing. Ranged is billed per-shot at press
 *  time (the discrete-fire path), so it's skipped here.
 *
 *  No fizzle: a CHARGED melee swing already paid its stamina by DRAINING it
 *  during the hold (the pour in charge-input) — the charge level is exactly what
 *  you could afford — so there's nothing to bill here on release. LIGHT swings
 *  are free (LIGHT_COST 0) and don't touch the resource at all, so the natural
 *  thumb-mash is never punished. */
export function spendSwingStamina(charged: boolean): void {
  if (getCurrentWeapon().ranged) return;
  if (charged) return;   // melee charge was paid via the pour during the hold
  if (CONFIG.STAMINA.LIGHT_COST > 0) spendStaminaSoft(CONFIG.STAMINA.LIGHT_COST);
}

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
 *  the intent threshold — caller should fire a neutral combo step.
 *  Strafe is split L/R so the sword can sweep IN the direction of
 *  the body's momentum. */
function pickAttackDirection(moveX: number, moveY: number): AttackDirection {
  const mag = Math.hypot(moveX, moveY);
  if (mag < MOVE_INTENT_THRESHOLD) return null;
  // Lateral wins on near-diagonals (STRAFE_AXIS_BIAS < 1). Sign of
  // moveX picks left vs right — moveX > 0 = strafing RIGHT.
  if (Math.abs(moveX) > Math.abs(moveY) * STRAFE_AXIS_BIAS) {
    return moveX > 0 ? 'strafe-right' : 'strafe-left';
  }
  // moveY < 0 in joystick convention means UP — the player is
  // pushing FORWARD relative to where the camera is facing.
  return moveY < 0 ? 'forward' : 'back';
}

/** Which SIDE of the screen the killing blow travelled to — used to lop the
 *  arm the player saw on that side (see enemy.ts dismember). The swing POSE is
 *  the source of truth: a `*-slash-left` / `*-sweep-left` pose cuts to the
 *  player's left, `*-right` to the right, and an un-suffixed slash (e.g.
 *  `dagger-slash`) is the right-handed default. Strafe direction is the
 *  fallback for poses with no left/right in the name. Thrusts/stabs return
 *  undefined — a straight poke has no side, so it beheads-or-nothing. */
function swingScreenSide(
  pose: string | undefined,
  dir: AttackDirection,
): 'L' | 'R' | undefined {
  if (pose) {
    if (pose.includes('left')) return 'L';
    if (pose.includes('right')) return 'R';
    if (pose.includes('slash') || pose.includes('sweep') || pose.includes('hook')) return 'R';
  }
  if (dir === 'strafe-left') return 'L';
  if (dir === 'strafe-right') return 'R';
  return undefined;
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
  /** Is an ENEMY in range right now? Melee: an enemy in the swing cone;
   *  ranged: an enemy in the forward arc with line of sight. The tap
   *  arbiter uses this for priority — an enemy in range means a tap
   *  ATTACKS even when an interactable is also nearby (see main.ts onTap).
   *  (Destructibles aren't counted — they're handled by the always-attack
   *  fallback, so a vase never out-prioritises a chest.) */
  hasEnemyInRange(): boolean;
}

function hapticVibrate(ms: number) {
  if (ms > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms);
  }
}

// Reusable scratch vectors.
const forwardDir = new THREE.Vector3();
const _camFwd = new THREE.Vector3();   // camera look dir, for aim-side dismember
const hitPoint = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpAim = new THREE.Vector3();

// Ranged auto-aim — tightened from a generous 34° half-arc to ~7°
// (0.12 rad). The player aims with the camera; auto-aim only snaps
// onto a target that's nearly dead-centred, correcting small thumb
// inaccuracies without doing the aiming FOR them. Misses are now
// possible, which is the point — ranged becomes skill-based.
const RANGED_REACH = 16;
const RANGED_CONE_COS = Math.cos(0.12);  // ~7° half-angle = 14° total cone

// ── Melee swing hit volume — a 3D capsule swept across the swing's arc ───────
// Genre-standard weapon hitbox: an authored, generously-sized capsule vs each
// enemy's hurtbox sphere (position + aimHeight, hitRadius). Posed along the
// player's TRUE look direction (pitch included), so ground-vs-upright differ,
// and forgiving via the capsule RADIUS (not by ignoring the vertical axis).
// Swept laterally across the swing's arc (sub-stepped) so a slash cleaves a line
// and a fast swing can't tunnel between frames.

// Preallocated swept-segment endpoints (max samples) — no per-swing alloc.
const swingEnds: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
const _swingAim = new THREE.Vector3();

/** Rotate `v` around world-up by `a` radians (keeps pitch). */
function rotateAroundY(v: THREE.Vector3, a: number, out: THREE.Vector3): void {
  const c = Math.cos(a), s = Math.sin(a);
  out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Shape the swing capsule from the swing's direction + the resolved cone width.
 *  `baseHalfAngle` (= acos cosConeHalf) carries the weapon/step/charge width, so
 *  authored coneHalfAngleMul still tunes the sweep. v3 per-move:
 *    forward  → thrust: narrow, no sweep
 *    strafe-R/L → slash: sweep, biased to the swung side
 *    back / neutral → a wide frontal sweep ≈ the old cone. */
function swingShape(dir: AttackDirection, reach: number, baseHalfAngle: number, radius: number, rise = 0): SwingShape {
  let sweepArc = baseHalfAngle * 2;   // ≈ the old cone's full width
  let sweepBias = 0;
  let r = radius;
  if (dir === 'forward') { sweepArc *= 0.30; r *= 0.9; }
  else if (dir === 'strafe-right') { sweepBias = sweepArc * 0.35; }
  else if (dir === 'strafe-left') { sweepBias = -sweepArc * 0.35; }
  return { reach, radius: r, sweepArc, sweepBias, rise };
}

// ── Swing resolver — swept weapon capsule vs. locational hurtbox ZONES ────────
// ONE hit path for everything Damageable (docs/COMBAT-HIT-SYSTEM.md): the weapon
// capsule is swept across the swing arc, and each sample is tested against the
// target's hurtbox zones (enemy body/head/weak/armor; a prop's single body
// sphere). It reports WHICH zone it caught — driving the damage/crit multiplier.
// Enemies and destructibles run through the same function; props just present a
// body zone with no head/weak, so they resolve cleanly with no special-casing.
const _worldZones: WorldZone[] = [];

export interface ZoneTargetHit<T extends Damageable = Damageable> { target: T; zoneHit: ZoneHit; d2: number }

function swingHitTargets<T extends Damageable>(
  targets: readonly T[],
  origin: THREE.Vector3,
  aimDir: THREE.Vector3,
  shape: SwingShape,
  maxTargets: number,
  hasLOS?: (cx: number, cz: number, tx: number, tz: number) => boolean,
): ZoneTargetHit<T>[] {
  const samples = Math.max(1, Math.min(swingEnds.length, CONFIG.SWORD_HITBOX_SWEEP_SAMPLES));
  const start = shape.sweepBias - shape.sweepArc / 2;
  const stepA = samples > 1 ? shape.sweepArc / (samples - 1) : 0;
  for (let s = 0; s < samples; s++) {
    rotateAroundY(aimDir, samples > 1 ? start + stepA * s : shape.sweepBias, _swingAim);
    swingEnds[s].set(
      origin.x + _swingAim.x * shape.reach,
      origin.y + _swingAim.y * shape.reach + shape.rise,
      origin.z + _swingAim.z * shape.reach,
    );
  }
  const wr = shape.radius;
  const hits: ZoneTargetHit<T>[] = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const count = resolveWorldZones(t.hurtbox, _worldZones);
    if (count === 0) continue;
    // Best zone across all swept samples — highest priority wins (head over body).
    let best: ZoneHit | null = null;
    for (let s = 0; s < samples; s++) {
      const zh = testSegmentZones(_worldZones, count, origin, swingEnds[s], wr);
      if (zh && (!best || zh.zone.priority > best.zone.priority)) best = zh;
    }
    if (!best) continue;
    const dx = t.position.x - origin.x;
    const dy = (t.position.y + t.aimHeight) - origin.y;
    const dz = t.position.z - origin.z;
    const distOrigin2 = dx * dx + dy * dy + dz * dz;
    // Point-blank (overlapping body) bypasses LOS — nothing can be between you.
    const pbR = POINT_BLANK_RADIUS + t.collisionRadius;
    const pointBlank = (dx * dx + dz * dz) < pbR * pbR;
    if (!pointBlank && hasLOS && !hasLOS(origin.x, origin.z, t.position.x, t.position.z)) continue;
    hits.push({ target: t, zoneHit: best, d2: distOrigin2 });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  return hits.slice(0, maxTargets);
}

export function createCombatSystem(
  camera: THREE.Camera,
  weapon: WeaponViewmodel,
  getEnemies: () => readonly Enemy[],
  getDestructibles: () => readonly Destructible[] = () => [],
  getWalkable: () => {
    hasLineOfSight: (x1: number, z1: number, x2: number, z2: number) => boolean;
    rayWallDistance: (ox: number, oz: number, dx: number, dz: number, maxDist: number) => number;
  } | undefined = () => undefined,
): CombatSystem {
  let strikeAlreadyHit = false;
  let wasStriking = false;
  let trailTimer = 0;     // > 0 → strike-trail hit window is open
  // Multi-hit FLURRY (a `hits` combo step, e.g. the dagger): re-open the strike
  // window a few times so ONE press lands N fast strikes. Each re-entry
  // re-gathers targets and re-rolls crit + on-hit procs INDEPENDENTLY — the
  // dagger identity (more rolls = more value from on-crit / on-hit / %-effects).
  let flurryRemaining = 0;   // sub-hits still owed after the first connect
  let flurryTimer = 0;       // seconds until the next sub-hit re-opens
  let flurryInterval = 0;    // gap between sub-hits (from the step's hits spec)
  let flurryArmed = false;   // this swing's flurry already set up (whiffs don't flurry)
  let flurrySubHit = false;  // current resolution is a flurry repeat → lighter crunch
  // Charge level 0..1 captured at attackPressed time; read by the
  // strike resolution to scale damage / reach / cone. Reset on each
  // new press (taps reset it to 0, charged swings to their progress).
  let currentSwingCharge = 0;
  // Whether the current swing was released in the perfect-charge window (melee
  // overcharge — extra damage + poise crack). Captured with currentSwingCharge.
  let currentSwingPerfect = false;
  // The swing's attack direction (thrust forward / slash strafe-L/R / back),
  // captured at press — shapes the hit capsule's sweep at strike time (v3).
  let currentSwingDirection: AttackDirection = null;
  // Player movement intent (joystick magnitude, 0..1) captured each tick — read
  // by fireRanged to bloom shots when moving (ranged commitment: plant to aim).
  let lastMoveMag = 0;

  // Friendly projectiles (crossbow/wand) hit-test enemies via this
  // provider — registered here so the projectile pool's tick needn't
  // take an extra arg (keeps the main-loop call site untouched).
  setProjectileEnemyProvider(getEnemies);
  setProjectileDestructibleProvider(getDestructibles);   // bolts smash vases/crates too

  // LIFESTEAL is now a CHANCE-ON-KILL proc (was a per-hit damage drain,
  // which the playtest found way too strong). On any enemy death (all
  // enemy deaths are player-caused — melee, ranged, or DoT), roll the
  // player's lifesteal chance and heal a flat amount. createCombatSystem
  // is constructed once at boot, so this subscribes once.
  on((e) => {
    if (e.type !== 'enemy:killed') return;
    if (gameRngChance(computePlayerStats().lifestealPct)) {
      healPlayer(CONFIG.LIFESTEAL_ON_KILL_HEAL);
    }
  });

  // SUBSTRATE — the blood-drinker payoff (docs/BUILD-ECONOMY.md). When a
  // BLEEDING enemy dies: FEED (heal — build-granted lifesteal that bends the
  // health economy) + CHAIN (the burst re-bleeds nearby enemies, so a pack
  // pops down a chain). Stat-gated, so it's inert unless a relic enables it —
  // this is the first status MACHINE; poison-detonate / burn-spread register
  // the same way. Registered once (createCombatSystem is built at boot).
  registerDeathPayoff((dying, pos) => {
    if (!dying.buffs?.some((b) => b.specId === 'bleed')) return;
    const s = computePlayerStats();
    if (s.bleedFeed > 0) healPlayer(s.bleedFeed, 'combat');
    if (s.bleedChain) {
      const r2 = CONFIG.BLEED_CHAIN_RADIUS * CONFIG.BLEED_CHAIN_RADIUS;
      for (const e of getEnemies()) {
        if (!e.alive) continue;
        const dx = e.position.x - pos.x, dz = e.position.z - pos.z;
        if (dx * dx + dz * dz > r2) continue;
        const ent = getEntity(e.entityId);
        if (ent) applyBuff(ent, 'bleed', CONFIG.BLEED_CHAIN_DURATION, 'player');
      }
    }
  });

  /** Fire the equipped ranged weapon's projectile at the auto-target
   *  (nearest enemy in the forward arc) or straight ahead if none. */
  function fireRanged(weapon: ResolvedWeaponStats) {
    if (!weapon.ranged) return;
    // Ranged auto-aim must respect LOS — without this the lock-on
    // would happily snap onto an enemy on the other side of a wall.
    const walkable = getWalkable();
    const losCheck = walkable
      ? (cx: number, cz: number, tx: number, tz: number) => walkable.hasLineOfSight(cx, cz, tx, tz)
      : undefined;
    const target = pickTarget(getEnemies(), camera, forwardDir, Math.hypot(forwardDir.x, forwardDir.z) || 1, RANGED_REACH, RANGED_CONE_COS, losCheck);
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
    // RANGED COMMITMENT — accuracy demands stillness. Moving (kiting) blooms the
    // shot off-aim; planted = dead-on. Rotate the aim about the muzzle in the XZ
    // plane by a random angle scaled by movement intent, so backpedal-spam
    // scatters and a real shot means stopping and exposing yourself. Auto-aimed
    // shots bloom too (rotation applied after lock-on), so lock-spam can't dodge
    // the rule. Uses the seeded rng so the scatter is deterministic for replays.
    const bloom = CONFIG.RANGED_MOVE_SPREAD_RAD * lastMoveMag;
    if (bloom > 0) {
      const ang = (gameRng() * 2 - 1) * bloom;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      const rx = tmpAim.x - tmpMuzzle.x;
      const rz = tmpAim.z - tmpMuzzle.z;
      tmpAim.x = tmpMuzzle.x + (rx * cosA - rz * sinA);
      tmpAim.z = tmpMuzzle.z + (rx * sinA + rz * cosA);
    }
    const crit = gameRngChance(weapon.critChance ?? 0);
    // Same charge-damage curve as melee — a fully-cooked shot does
    // +80% damage. Held aim with a focus / charged crossbow becomes
    // worth the wait.
    const chargeMul = 1 + currentSwingCharge * 0.80;
    const dmg = (crit ? weapon.damage * (weapon.critMultiplier ?? 2) : weapon.damage) * chargeMul;

    // Multi-projectile FAN — throwing knives spawn N projectiles per
    // strike with angular spread around the aim line. count=1 (the
    // default) collapses to a single shot identical to before. The
    // spread is applied in the horizontal plane only; vertical aim
    // (from camera pitch) is shared by every knife in the fan.
    const count = weapon.ranged.count ?? 1;
    const spread = weapon.ranged.spread ?? 0;
    const onHits = getPlayerOnHits();
    if (count === 1) {
      spawnProjectile({
        typeId: weapon.ranged.projectileId,
        origin: tmpMuzzle,
        target: tmpAim,
        damage: dmg,
        source: 'player',
        friendly: true,
        // Carry the player's on-hit statuses onto the bolt so a
        // ranged weapon's base on-hit (the wand's chill) + on-hit
        // affixes + set bonuses all land — same rules as melee.
        onHits,
        // Crit roll travels with the bolt so ranged crits + HEADSHOTS land.
        critChance: weapon.critChance,
        critMultiplier: weapon.critMultiplier,
      });
    } else {
      // Compute the centre aim direction (from muzzle to tmpAim) and
      // rotate it by ±spread for each fan member. Fan is centred —
      // an odd count puts one knife dead-centre; even counts split.
      const baseDX = tmpAim.x - tmpMuzzle.x;
      const baseDZ = tmpAim.z - tmpMuzzle.z;
      const aimDist = Math.hypot(baseDX, baseDZ) || 0.001;
      for (let i = 0; i < count; i++) {
        // map i in [0, count-1] to t in [-1, +1]
        const t = count === 1 ? 0 : (2 * i / (count - 1)) - 1;
        const ang = t * spread;
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        const dx = baseDX * cosA - baseDZ * sinA;
        const dz = baseDX * sinA + baseDZ * cosA;
        // Each knife in the fan does a fraction of total damage so
        // throwing 3 knives isn't strictly 3× a crossbow shot — it's
        // ~1.5× (slightly more, since hits stack) traded for spread.
        const perKnifeDmg = dmg * (0.55 + 0.20 / count);
        const fanTarget = new THREE.Vector3(
          tmpMuzzle.x + dx * (aimDist / aimDist),
          tmpAim.y,
          tmpMuzzle.z + dz * (aimDist / aimDist),
        );
        spawnProjectile({
          typeId: weapon.ranged.projectileId,
          origin: tmpMuzzle,
          target: fanTarget,
          damage: perKnifeDmg,
          source: 'player',
          friendly: true,
          onHits,
          critChance: weapon.critChance,
          critMultiplier: weapon.critMultiplier,
        });
      }
    }
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
    // Track movement intent for ranged accuracy bloom (plant to aim).
    lastMoveMag = Math.min(1, Math.hypot(moveX, moveY));
    // Publish the movement-direction bucket every frame so the viewmodel can
    // PRIME the weapon toward the directional attack you'd get (move-intent.ts).
    {
      const d = pickAttackDirection(moveX, moveY);
      setMoveIntent(d === 'forward' ? 'forward' : d === 'back' ? 'back'
        : d === 'strafe-left' ? 'left' : d === 'strafe-right' ? 'right' : null);
    }
    // Telegraph the live joystick direction while a melee charge is held, so the
    // viewmodel can foretell (and switch) which way the heavy will strike.
    setChargeDirection(
      getChargeProgress() > 0 && !getCurrentWeapon().ranged ? pickAttackDirection(moveX, moveY) : null,
    );
    if (attackPressed) {
      // Gate: if nothing is equipped in the weapon slot, swallow the
      // press silently. Avoids the bare-hands attack sound + the
      // viewmodel-less swing animation that fires when the player
      // hasn't picked up a weapon yet.
      if (!getEquipped('weapon')) {
        return;
      }
      // FSM gate: no new swing while committed to a parry or a dodge (the
      // action FSM owns this lockout; combo chaining within a swing is still
      // the swing sim's own concern).
      if (!canStartAction('attack')) return;
      // STAMINA gates the two drawback-free actions the playtest flagged.
      // Read the resolved weapon once at press time to branch ranged/melee.
      const pressWeapon = getCurrentWeapon();
      // RANGED: every shot costs stamina (the crossbow/wand drawback —
      // "too strong, no ammo, no drawback"). Soft spend — it fires as long as
      // you have a sliver and just gasses you, so a low-stamina shot still
      // goes off. It's gated ONLY when the bar is visibly empty, and then the
      // HUD flashes so the rejected tap reads as "you're out", not a dead tap.
      if (pressWeapon.ranged && !spendStaminaSoft(CONFIG.STAMINA.RANGED_COST)) {
        flashStaminaBar();
        return;
      }
      // Capture any pending charge for this press — 0 if it was a tap, 0..1 if
      // the player held to charge — plus whether it was a PERFECT release. The
      // strike-phase resolution below reads currentSwingCharge to scale damage,
      // reach, and cone, and currentSwingPerfect for the overcharge bonus. Reset
      // per-press, so chained tap-combos reset to 0 on the next press.
      //
      // No fizzle, by construction: a MELEE charge is a stamina pour
      // (charge-input drains as you hold), so the charge level already reflects
      // exactly what you could afford — at empty it never builds, so a tap just
      // does a free light swing. Nothing to downgrade here.
      currentSwingCharge = consumeChargedAmount();
      currentSwingPerfect = consumeChargedPerfect();
      if (currentSwingPerfect) {
        // Confirm the clean timing the instant they release — same "nailed it"
        // language as the just-dodge (a sharp sting + a firm pulse).
        playBuffApply();
        hapticVibrate(CONFIG.CHARGE.PERFECT_HAPTIC_MS);
      }
      // Movement intent at press time. Picks a directional move override
      // (lunge / sweep / retreat) when the joystick is held — null otherwise
      // (= normal combo step). The class spec decides whether one is registered.
      const direction = pickAttackDirection(moveX, moveY);
      currentSwingDirection = direction;   // shapes the hit capsule sweep at strike
      // Whoosh + 'attack:swing' fire from the viewmodel's onSwingStart so chained
      // combo steps make sound too, not just the first press. Charged releases
      // SKIP the windup phase — the player paid for it by holding; the cocked-
      // back idle pose blends continuously into the strike's t=0 pose. Set the
      // charged-strike glow IMMEDIATELY before so the emissive ramp lands on
      // this swing's strike phase, not the next one's.
      weapon.setSwingCharge(currentSwingCharge);
      weapon.startSwing({ skipWindup: currentSwingCharge > 0, direction });
    }

    const striking = weapon.isStriking;
    const wpMoves = getCurrentWeapon().moves;
    const timelineMove = !!(wpMoves && wpMoves.length);

    if (striking && !wasStriking) {
      strikeAlreadyHit = false;
      trailTimer = 0;
      flurryArmed = false;
      flurryRemaining = 0;
      flurrySubHit = false;
    }
    // Strike phase just ended. Open the trail window if EITHER we haven't
    // connected yet (a near-miss still lands in the tail) OR a FLURRY is still
    // owed — sized to finish the remaining sub-hits. The flurry case is the fix
    // for the "1-1-3" bug: the flurry timer starts at the FIRST connect, so on a
    // short step (opener 0.18s) a late connect leaves no strike time for the
    // sub-hits, and without a trail they silently collapse to a single hit. The
    // long finisher (0.26s) had the slack to survive, which is why only it
    // flurried. Now every step gets a window long enough to finish its rips.
    if (wasStriking && !striking) {
      if (flurryRemaining > 0) {
        trailTimer = Math.max(trailTimer, flurryRemaining * flurryInterval + 0.03);
      } else if (!strikeAlreadyHit) {
        trailTimer = STRIKE_TRAIL_DURATION;
      }
    }
    wasStriking = striking;

    // TIMELINE MODE (docs/MOVE-TIMELINE.md): hits come from the move's strike
    // times, not the strike window. Open the hit window ONLY on a frame where a
    // strike was crossed; keep it shut otherwise (so the move never fires a free
    // legacy hit). The legacy flurry re-entry below stays inert — flurryRemaining
    // is 0 because the arm is guarded off for a move. First strike = full crunch;
    // the rest read as flurry sub-hits (light crunch + flurryChance).
    if (timelineMove) {
      const s = weapon.consumeStrikes();
      strikeAlreadyHit = s.count === 0;
      if (s.count > 0) flurrySubHit = s.startIndex > 0;   // opening rip = full crunch
    }

    // Hit-test runs during strike OR during the trail tail (if we
    // haven't connected yet). Once strikeAlreadyHit is true, both
    // windows close until the next swing.
    // FLURRY re-entry: while sub-hits are owed and the strike phase is still
    // live, count down and RE-OPEN the strike window (clear strikeAlreadyHit)
    // so the resolution below runs again as a fresh, independently-rolled hit.
    // Sub-hits may finish in the brief trail tail too, not just the strike phase
    // — otherwise the SHORT early combo windows (0.15–0.18s) drop their last
    // rips while only the long finisher (0.26s) survives, biasing every flurry
    // weapon toward its finisher. The first hit already lands in the trail (below).
    if (flurryRemaining > 0 && (striking || trailTimer > 0)) {
      flurryTimer -= dt;
      if (flurryTimer <= 0) {
        flurryTimer += flurryInterval;
        flurryRemaining -= 1;
        strikeAlreadyHit = false;
        flurrySubHit = true;
        weapon.flurryJab();   // visible stab per rip, in sync with the damage
      }
    }
    const inHitWindow = (striking || trailTimer > 0) && !strikeAlreadyHit;
    if (trailTimer > 0) trailTimer = Math.max(0, trailTimer - dt);
    if (!inHitWindow) return;

    camera.getWorldDirection(forwardDir);  // unit vector
    // Two refs to read from in this block: `weapon` (the viewmodel —
    // exposes isStriking / getActiveStep / isFinisherStrike) and
    // `stats` (the resolved combat numbers — reach / damage / etc.).
    const stats = getCurrentWeapon();

    // RANGED branch — a crossbow/wand FIRES a projectile at the auto-
    // target instead of doing a melee cone hit. One shot per strike
    // (strikeAlreadyHit), the weapon's slow recover IS the reload.
    if (stats.ranged) {
      fireRanged(stats);
      strikeAlreadyHit = true;
      return;
    }

    // Per-combo-step reach + cone + multi-target. The active step's
    // reachMul / coneHalfAngleMul / maxTargets layer over the weapon's
    // base stats so each combo position has its own character:
    // sword's slashes cleave 2 at standard reach, thrust finisher
    // extends and narrows; hammer smash cleaves 3 with wider arc.
    //
    // Hold-to-charge: a fully charged swing extends reach by 20%, widens the
    // cone by 25%, and adds one extra multi-target slot only to swings that
    // ALREADY cleave (maxTargets >= 2) — a charged single-target poke stays
    // single-target, so charge sweeps the sweepers without turning every poke
    // into an AoE. Damage scaling happens at the per-target calc below.
    const step = weapon.getActiveStep();
    const c = currentSwingCharge;
    // Per-combo-step damage / poise shaping (% of weapon damage). Authored per
    // archetype (weapon-classes.ts) + overridable per weapon (comboTuning). A
    // finisher hits >100%, a quick jab <100%. Default 1.0 = one clean hit.
    // A flurry step splits its damage across sub-hits — each hit uses the
    // flurry's own per-hit fraction, ignoring the step's flat damageMul.
    const stepDamageMul = timelineMove ? weapon.getMoveDamageMul()
      : step?.hits ? step.hits.damageMul : (step?.damageMul ?? 1);
    const stepStaggerMul = step?.staggerMul ?? 1;
    // Directional-dismember side — resolved per target below. Two parts are
    // strike-wide: the player's explicit STRAFE intent, and the swing's authored
    // pose. The pose alone CAN'T be trusted — a held direction swaps combo step 0
    // for a directional variant, so the opener's left/right isn't fixed — which
    // is exactly why strafe + aim take priority over it.
    const strafeSide: 'L' | 'R' | undefined =
      currentSwingDirection === 'strafe-left' ? 'L'
      : currentSwingDirection === 'strafe-right' ? 'R' : undefined;
    const poseSide = swingScreenSide(step?.pose, currentSwingDirection);
    const reach = stats.reach * (step?.reachMul ?? 1) * (1 + c * 0.20);
    const cosConeHalf = Math.cos(stats.coneHalfAngle * (step?.coneHalfAngleMul ?? 1) * (1 + c * 0.25));
    const baseTargets = step?.maxTargets ?? 1;
    const maxTargets = baseTargets + (c >= 0.7 && baseTargets >= 2 ? 1 : 0);

    // The hit is a 3D capsule along the TRUE look dir (forwardDir is the camera's
    // 3D world direction — pitch included), swept across the swing's arc and
    // shaped by the swing direction. Reuse the resolved cone width as the sweep
    // span; reach + cleave still come from the weapon/step. Forgiveness lives in
    // the capsule RADIUS, not in flattening the vertical — so ground vs upright
    // genuinely differ, but a fat hitbox keeps it phone-friendly.
    const baseHalfAngle = Math.acos(Math.max(-1, Math.min(1, cosConeHalf)));
    // Enemy weapon capsule: a thin blade (precise core) + the global forgiveness
    // inflation, charge-scaled. Swept along the arc and tested against each
    // enemy's hurtbox ZONES (body / head / weak / armor) — see hurtbox.ts.
    const enemyRadius = (CONFIG.MELEE_HITBOX_RADIUS + CONFIG.MELEE_HITBOX_INFLATION) * (1 + c * 0.2);
    // Per-move 3D shaping: the step's `rise` drops/raises the capsule's far end
    // (overhead smash crushes low-forward; thrust stays level). Charge extends
    // the drop slightly so a charged smash reaches even further down.
    const moveRise = (step?.rise ?? 0) * (1 + c * 0.2);
    const enemyShape = swingShape(currentSwingDirection, reach, baseHalfAngle, enemyRadius, moveRise);

    // LOS: a swing can't poke through a wall to hit a hidden enemy (or vase).
    const walkable = getWalkable();
    const losCheck = walkable
      ? (cx: number, cz: number, tx: number, tz: number) => walkable.hasLineOfSight(cx, cz, tx, tz)
      : undefined;
    // Enemies take priority; props only fall through when no enemy was in the
    // volume (a vase shouldn't soak a swing meant for the mob behind it).
    const enemyHits = swingHitTargets(getEnemies(), camera.position, forwardDir, enemyShape, maxTargets, losCheck);
    // Destructibles run the SAME resolver AND the same swing capsule as enemies
    // — props now carry a real body sphere, so the old extra reach/radius
    // forgiveness is redundant. Capped at 2; only tested when no enemy was hit
    // (a vase shouldn't soak a swing meant for the mob behind it).
    const destrShape = enemyShape;
    const destrMax = Math.min(maxTargets, 2);
    const hitList: ZoneTargetHit[] = enemyHits.length > 0
      ? enemyHits
      : swingHitTargets(getDestructibles(), camera.position, forwardDir, destrShape, destrMax, losCheck);
    // Combat debug: draw the live capsules + hurtbox zones (no-op unless on),
    // and flash + echo the exact zone(s) this swing connected with.
    showHitCones(camera, forwardDir, enemyShape, destrShape);
    if (hitList.length > 0) markSwingHits(hitList.map((h) => ({ hurtbox: h.target.hurtbox, zone: h.zoneHit.zone })));
    const targets: Array<{ target: Damageable; zone?: ZoneHit }> =
      hitList.map((h) => ({ target: h.target, zone: h.zoneHit }));
    if (targets.length === 0) {
      // No enemy / vase in cone — check if we whiffed INTO A WALL. The
      // dungeon acknowledges it: a short metallic tink, a brief haptic,
      // a tiny camera kick. Only fires ONCE per swing (strikeAlreadyHit
      // latches), and only if a wall is genuinely inside the swing's
      // reach in the forward direction — a swing into open space stays
      // silent (the whoosh from onSwingStart already played).
      if (striking && walkable) {
        // The wall ray is 2D (XZ), so normalise the look dir to the horizontal.
        const forwardLenXZ = Math.hypot(forwardDir.x, forwardDir.z) || 1;
        const dxn = forwardDir.x / forwardLenXZ;
        const dzn = forwardDir.z / forwardLenXZ;
        const wallDist = walkable.rayWallDistance(camera.position.x, camera.position.z, dxn, dzn, reach);
        if (wallDist < reach) {
          const hx = camera.position.x + dxn * wallDist;
          const hz = camera.position.z + dzn * wallDist;
          playSurfaceHit('stone', { x: hx, y: camera.position.y, z: hz });
          hapticVibrate(18);
          kickShake(0.05, 0.10);
          // CLANK back — the wall shoves the blade home. Visible recoil on
          // the viewmodel + the swing INTERRUPTS into recover so the strike
          // visibly ends short instead of grinding through the wall surface.
          applyViewmodelKickback(0.30);
          weapon.interruptSwing();
          strikeAlreadyHit = true;
        }
      }
      return;
    }

    strikeAlreadyHit = true;

    // Player-stat layer — read ONCE per strike so a 3-target sweep
    // shares the same crit chance / lifesteal % / finisher mul (the
    // per-target *roll* is still independent, but the rate isn't).
    const ps = computePlayerStats();

    // Crit per-hit so a 3-target sweep can crit one and not the
    // others — feels better than one roll applying to the whole arc.
    // Item crit bonuses stack ADDITIVELY on the weapon's intrinsic
    // chance / multiplier; the final chance clamps at 1.0.
    const critChance = Math.min(1, (stats.critChance ?? 0) + ps.critChanceBonus);
    const critMult   = (stats.critMultiplier ?? 2.0) + ps.critMultBonus;
    const finisherMult = weapon.isFinisherStrike ? ps.finisherDamageMultiplier : 1;

    // Charged-swing damage multiplier — fully charged ×1.8, ramps
    // linearly from charge progress (c). A PERFECT release (timed the instant
    // the charge topped out) OVERCHARGES on top of that — the offense mirror of
    // the just-dodge's perfect-timing reward.
    const perfectDmgMul = currentSwingPerfect ? CONFIG.CHARGE.PERFECT_DAMAGE_MUL : 1;
    const perfectStaggerMul = currentSwingPerfect ? CONFIG.CHARGE.PERFECT_STAGGER_MUL : 1;
    const chargeDamageMul = (1 + c * 0.80) * perfectDmgMul;

    // Just-dodge counter — if a perfectly-timed dodge opened a counter window,
    // this swing punishes harder AND cracks poise harder. Read once; consumed
    // below only if a real enemy is hit (a whiff shouldn't waste the opening).
    const counterActive = isJustDodgeCounterActive();
    // A recent DEFLECT empowers this swing too (the aggressive payoff: deflect
    // → big follow-up). Stacks multiplicatively with the dodge counter on the
    // rare frame both are live.
    // SOFT LIGHT-LOCKOUT: only a LIGHT swing (c === 0, no charge) cashes the
    // deflect empower — a charged heavy gets nothing AND doesn't consume it (the
    // consume below keys off this flag), so the opening persists for a light
    // riposte. This is what gives LIGHT/reactive play its own payoff: parry →
    // empowered light flurry, distinct from the heavy poise-smash game.
    const empowerActive = isDeflectEmpowerActive() && c === 0;
    const counterDmgMul = (counterActive ? CONFIG.JUST_DODGE.COUNTER_DAMAGE_MUL : 1)
      * (empowerActive ? CONFIG.DEFLECT.EMPOWER_DAMAGE_MUL : 1);
    const counterStaggerMul = (counterActive ? CONFIG.JUST_DODGE.COUNTER_STAGGER_MUL : 1)
      * (empowerActive ? CONFIG.DEFLECT.EMPOWER_STAGGER_MUL : 1);

    let anyCrit = false;
    let bestApplied = 0;
    let anyHeavy = false;
    let anyExecute = false;
    let anyStagger = false;
    // targets are sorted NEAREST-first, so index 0 is the primary (full) hit and
    // each subsequent cleaved target takes the geometric falloff cut.
    for (let ti = 0; ti < targets.length; ti++) {
      const { target, zone } = targets[ti];
      // AIM side: which side of the player's VIEW this target sits on. Lets a
      // neutral tap pick the arm by where you're LOOKING — turn slightly so the
      // skull is on your right and the right arm goes. Priority: explicit strafe
      // → aim → the (untrustworthy) authored pose. cross of camera-forward × to-
      // target on the XZ plane: >0 = target to the player's right.
      camera.getWorldDirection(_camFwd);
      const tdx = target.position.x - camera.position.x;
      const tdz = target.position.z - camera.position.z;
      const tdist = Math.hypot(tdx, tdz) || 1;
      const aimLat = (_camFwd.x * tdz - _camFwd.z * tdx) / tdist;
      const aimSide: 'L' | 'R' | undefined =
        aimLat > 0.12 ? 'R' : aimLat < -0.12 ? 'L' : undefined;
      const severSide = strafeSide ?? aimSide ?? poseSide;
      // FINISHER: a CHARGED HEAVY on a STAGGERED foe executes — damage ×MUL
      // (lethal in nearly all cases) + the sustain reward below. Captured BEFORE
      // the hit (the target's pre-hit state is what's executable). The charge
      // gate (c >= EXECUTE.MIN_CHARGE) is the design: light swings DON'T execute,
      // so you light-combo the open stagger window for damage, then heavy-finish.
      // (hitFeedback === 'heavy' = a mob, not a vase — vases never "execute".)
      const isExecute = target.hitFeedback === 'heavy' && !!target.executable
        && c >= CONFIG.EXECUTE.MIN_CHARGE;
      // Locational zone: head/weak points multiply damage; head forces a crit.
      // Armor zones (damageMul 0) soak the blow to nothing.
      const zoneMul = zone?.damageMul ?? 1;
      // Cleave falloff: nearest target full, the rest diminish (floored). A graze
      // is any non-primary cleaved hit — shown small + dim so you read who ate it.
      const cleaveMul = ti === 0 ? 1 : Math.max(CONFIG.CLEAVE_DAMAGE_MIN, CONFIG.CLEAVE_DAMAGE_FALLOFF ** ti);
      const graze = ti > 0 && !isExecute;
      // Zone crit: a forced crit (earned weak point) OR a roll boosted by the
      // zone's additive critBonus (the head — crits more often, not always).
      const crit = (zone?.crit ?? false) || gameRngChance(critChance + (zone?.critBonus ?? 0));
      const execMul = isExecute ? CONFIG.EXECUTE.DAMAGE_MUL : 1;
      const baseDamage = (crit ? stats.damage * critMult : stats.damage) * finisherMult * chargeDamageMul * counterDmgMul * zoneMul * cleaveMul * execMul * stepDamageMul;
      const applied = target.takeDamage({
        source: 'player',
        target: target.entityId,
        base: baseDamage,
        type: 'physical',
        hitZoneId: zone?.zone?.id,   // for dismember-on-kill (head zone → behead)
        // Directional dismember: a slash kill lops the arm on the side the blade
        // travelled toward (the player's view side — enemy.ts maps it to the
        // visible arm by world position, so enemy facing/mirroring is handled).
        severSide,
      });

      // Damage number floats from this target's aim point.
      hitPoint.set(target.position.x, target.position.y + target.aimHeight, target.position.z);
      if (applied > 0) spawnDamageNumber(camera, hitPoint, applied, crit, graze, isExecute);
      // The floor remembers: every landed hit throws a DIRECTIONAL
      // spray away from the blow (streak + satellite droplets), in the
      // target's own blood. Repeated blows in one spot pool.
      if (applied > 0) {
        const gore = (target as { bloodAmount?: number }).bloodAmount ?? 1;
        if (gore > 0.01) {
          // IMPACT-SCALED splash from the weapon's strike: damage sets
          // the energy, the swing sets the direction, and whatever the
          // splash reaches — floor, wall, prop base — gets painted.
          // Chip hits speckle; heavies drench; crits and executes
          // detonate. (energy ~0.35 at 1 dmg → 1.0 around 8 dmg.)
          const energy = Math.min(1.5, (0.3 + applied * 0.09)
            * (crit ? 1.35 : 1) * (isExecute ? 1.5 : 1)) * gore;
          // Splash direction = the BLADE'S TRAVEL, not just player→
          // enemy: a slash from the left flings blood rightward, a
          // thrust drives it straight through, a neutral sweep fans
          // wide. Forward (radial) and lateral (tangential) mix by
          // swing type. Right vector = forward rotated -90° about Y.
          const fx = target.position.x - camera.position.x;
          const fz = target.position.z - camera.position.z;
          const fl = Math.hypot(fx, fz) || 1;
          const nfx = fx / fl, nfz = fz / fl;
          const rx = -nfz, rz = nfx;
          let lateral = 0;
          let forwardK = 1.0;
          if (currentSwingDirection === 'strafe-right') { lateral = 0.95; forwardK = 0.45; }
          else if (currentSwingDirection === 'strafe-left') { lateral = -0.95; forwardK = 0.45; }
          else if (currentSwingDirection === 'forward') { lateral = 0; forwardK = 1.0; }
          else { lateral = (Math.random() < 0.5 ? -1 : 1) * 0.55; forwardK = 0.7; }
          emitGoreSplash(
            target.position.x, target.position.z,
            target.position.y + 0.5 + target.aimHeight * 0.5 + Math.random() * 0.25,
            nfx * forwardK + rx * lateral,
            nfz * forwardK + rz * lateral,
            energy,
            (target as { bloodColor?: number }).bloodColor ?? 0x6e1410,
            { sizeMul: Math.min(1.8, 0.75 + ((target as { collisionRadius?: number }).collisionRadius ?? 0.3) * 0.9) },
          );
        }
      }

      // Finisher reward — earned, kill-based sustain (heal + stamina). The loop
      // resolves per target, so an execute on each of two staggered foes pays
      // twice; that's the aggression payoff.
      if (isExecute) {
        anyExecute = true;
        if (CONFIG.EXECUTE.HEAL > 0) healPlayer(CONFIG.EXECUTE.HEAL);
        if (CONFIG.EXECUTE.STAMINA > 0) gainStamina(CONFIG.EXECUTE.STAMINA);
      }

      // On-hit statuses roll per-target on heavies (mobs) — vases
      // don't bleed.
      if (target.hitFeedback === 'heavy') {
        anyHeavy = true;
        const ent = getEntity(target.entityId);
        if (ent) {
          // FLURRY proc chance is AUTHORED per weapon (docs/BUILD-ECONOMY.md): the
          // first rip rolls `chance`; each flurry sub-hit rolls the weapon's own
          // `flurryChance` — so a dagger sets a low `chance` and lets its flurry
          // carry the bleed, while a slow single-hit weapon sets a high `chance`
          // and never out-applies it. A weapon that doesn't bother falls back to
          // `chance × FLURRY_PROC_DIMINISH` so nothing accidentally stacks 300%.
          for (const oh of getPlayerOnHits()) {
            const chance = flurrySubHit
              ? (oh.flurryChance ?? oh.chance * CONFIG.FLURRY_PROC_DIMINISH)
              : oh.chance;
            if (gameRngChance(chance)) applyBuff(ent, oh.buffId, oh.duration, 'player');
          }
          // Empowered-hit verb — fires on a hit during the deflect-empower
          // window (empowerActive is already light-gated above, so this is the
          // empowered LIGHT riposte). e.g. a blade that poisons harder off a parry.
          if (empowerActive) fireCombatVerb(stats.onEmpoweredHit, target.entityId, 'enemy');
        }
        emit({ type: 'attack:hit', damage: applied, crit, cls: stats.class });
        // Might SIGNATURE — chip the target's poise; break it and the
        // enemy staggers (its action cancelled, a free-hit window). A
        // full charge hits poise hardest. staggerPower already folds in
        // weapon weight × Might (resolveWeaponStats). Returns true on the hit
        // that BREAKS the guard → fire the loud "STAGGERED" cue.
        const broke = target.applyStaggerDamage?.(stats.staggerPower * (1 + c * CONFIG.POISE.CHARGE_BONUS) * counterStaggerMul * perfectStaggerMul * stepStaggerMul) ?? false;
        if (broke) {
          anyStagger = true;
          spawnStatusText(camera, hitPoint, 'STAGGERED', 'rgba(255, 226, 150, 0.99)');
          playSurfaceHit('stone', target.position);   // sharp guard-cracks-open crack
        }
        // (Lifesteal is now a CHANCE-ON-KILL proc — see the enemy:killed
        // listener in createCombatSystem — not a per-hit drain, which was
        // far too strong in the playtest.)
      }
      if (crit) anyCrit = true;
      if (applied > bestApplied) bestApplied = applied;
    }

    // Aggression reward: a melee swing that landed on a real enemy (heavy
    // feedback — not a vase) refunds stamina, once per swing. Lands here in the
    // melee strike path only, so ranged never refunds. Keeps offense fueled
    // without making attacks free (net cost stays positive).
    if (anyHeavy && CONFIG.STAMINA.REFUND_ON_HIT > 0) {
      gainStamina(CONFIG.STAMINA.REFUND_ON_HIT);
    }
    // Spend the just-dodge counter on a connecting hit — one discrete punish,
    // not a free DPS window (a whiff during the window keeps it open).
    if (anyHeavy && counterActive) consumeJustDodgeCounter();
    // Same for the deflect empower — any connecting hit (not just heavies)
    // spends it, so the deflect→strike payoff lands on whatever you throw.
    if (bestApplied > 0 && empowerActive) consumeDeflectEmpower();

    // --- THE CRUNCH ---
    // One hit-pause + shake per swing regardless of target count —
    // stacking N freezes for an N-cleave would feel terrible. Use
    // the best-hit's stats (any-crit, any-heavy) so a cleave that
    // crit-killed a mob and grazed a vase still gets the full crunch.
    // Impact sound plays at the CLOSEST target's position — gives the
    // hit a directional sense (pans + room reverb tail) instead of a
    // flat dry thud at the listener.
    const impactAt = targets[0].target.position;
    if (anyHeavy) {
      // Weight the crunch by the BEST hit's damage — a big blow freezes
      // longer + shakes harder than a chip hit, on top of the crit bonus.
      // Heavy hits land heavy; that's the offensive half of "crunchy".
      const s = Math.min(
        CONFIG.HIT_FEEDBACK_DMG_MAX,
        1 + Math.max(0, bestApplied - 1) * CONFIG.HIT_FEEDBACK_DMG_SLOPE,
      );
      // FREEZE: short, gently damage-scaled, HARD-CAPPED — decoupled from
      // the shake so heavy hits stay punchy without the long hang that
      // read as lag (10 dmg was 192ms / 336ms on a crit → now ~120 / ~135).
      const crit = anyCrit ? CONFIG.FREEZE_CRIT_BONUS_MS : 0;
      const crunchPause = Math.min(
        CONFIG.FREEZE_MAX_MS + crit,
        CONFIG.FREEZE_BASE_MS + bestApplied * CONFIG.FREEZE_PER_DMG + crit,
      );
      // Shake + haptic keep the full damage-scaled punch (they animate
      // through the freeze, so they carry the "weight").
      const crunchShake = (anyCrit
        ? CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 1.8
        : CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE) * s;
      // Flurry sub-hits get a LIGHT crunch — stacking N full freezes would
      // stutter. The first hit of the flurry lands the normal crunch; the
      // repeats are quick taps (tiny freeze, softer shake/haptic).
      freezeFor(flurrySubHit ? Math.min(crunchPause, 22) : crunchPause);
      kickShake(flurrySubHit ? crunchShake * 0.5 : crunchShake, CONFIG.SCREEN_SHAKE_HIT_DURATION);
      hapticVibrate(Math.round((anyCrit ? CONFIG.HAPTIC_HIT_MS * 2 : CONFIG.HAPTIC_HIT_MS) * s * (flurrySubHit ? 0.5 : 1)));
      playImpact(impactAt);
      // FINISHER emphasis — a hard hitch + a second heavier thud so the kill
      // lands with the weight of a DOOM glory-kill / Souls riposte.
      if (anyExecute) {
        freezeFor(CONFIG.FREEZE_MAX_MS + CONFIG.FREEZE_CRIT_BONUS_MS);
        kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 2.4, CONFIG.SCREEN_SHAKE_HIT_DURATION * 1.3);
        hapticVibrate(CONFIG.HAPTIC_HIT_MS * 2);
        playImpact(impactAt);
      }
      // STAGGER BREAK punctuation — a snappy hitch + buzz so breaking a guard
      // is FELT, distinct from a normal hit (the popup + crack carry the rest).
      else if (anyStagger) {
        freezeFor(Math.min(CONFIG.FREEZE_MAX_MS, CONFIG.FREEZE_BASE_MS * 2));
        kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 1.5, CONFIG.SCREEN_SHAKE_HIT_DURATION);
        hapticVibrate(CONFIG.HAPTIC_HIT_MS * 2);
      }
    } else {
      // Light targets only (vases / crates / etc.) — token crunch, no on-hit
      // passives. Voice the strike by the prop's hitMaterial when set so a
      // vase rings ceramic / a chest knocks wood / etc.; fall back to the
      // generic playImpact thump if none is declared so a new destructible
      // doesn't go silent before its material is set.
      freezeFor(Math.min(40, CONFIG.HIT_PAUSE_MS * 0.4));
      kickShake(CONFIG.SCREEN_SHAKE_HIT_MAGNITUDE * 0.4, CONFIG.SCREEN_SHAKE_HIT_DURATION * 0.5);
      hapticVibrate(CONFIG.HAPTIC_HIT_MS / 2);
      const material = targets.find((t) => t.target.hitMaterial)?.target.hitMaterial;
      if (material) playSurfaceHit(material, impactAt);
      else          playImpact(impactAt);
    }

    // SIGNATURE CHARGED EFFECT — only on real combat hits (anyHeavy)
    // and only when charge crossed the weapon's threshold. Lets a
    // sword "shoot a wave" or a hammer "thunderclap" only when the
    // player committed to the charge. Projectile is the only kind
    // wired today; AoE / lifesteal / cleave land on this same hook.
    if (anyHeavy && stats.chargedEffect && currentSwingCharge >= (stats.chargedEffect.minCharge ?? 0.7)) {
      const eff = stats.chargedEffect;
      if (eff.kind === 'projectile') {
        // Spawn from the muzzle (in front of the camera, slightly
        // below — same offset as ranged shots) flying along the
        // camera forward direction. Damage scales with the weapon's
        // base damage and the optional damageMul; carries the charge
        // bonus on top.
        const tmpProjMuzzle = new THREE.Vector3()
          .copy(camera.position)
          .addScaledVector(forwardDir, 0.5);
        tmpProjMuzzle.y -= 0.15;
        const tmpProjTarget = new THREE.Vector3()
          .copy(camera.position)
          .addScaledVector(forwardDir, 14);
        const chargeBonus = 1 + currentSwingCharge * 0.80;
        spawnProjectile({
          typeId: eff.projectileId,
          origin: tmpProjMuzzle,
          target: tmpProjTarget,
          damage: stats.damage * (eff.damageMul ?? 1.5) * chargeBonus,
          source: 'player',
          friendly: true,
          critChance: stats.critChance,
          critMultiplier: stats.critMultiplier,
        });
      }
    }

    // Arm the FLURRY on the first CONNECTING hit of a `hits` step (anyHeavy =
    // a real mob, not a whiff or a vase). The re-entry block above then drives
    // the remaining sub-hits on the interval. Armed once per swing.
    if (!timelineMove && !flurryArmed && step?.hits && step.hits.count > 1 && anyHeavy) {
      flurryArmed = true;
      flurryRemaining = step.hits.count - 1;
      flurryInterval = step.hits.interval;
      flurryTimer = step.hits.interval;
      weapon.flurryJab();   // pop the first rip too, so the whole flurry stabs uniformly
    }

    void bestApplied;   // reserved for future "biggest hit wins crunch tier"
  }

  /** See CombatSystem.hasEnemyInRange. Mirrors what the next swing would
   *  hit, ENEMIES only: melee scans the weapon's cone; ranged scans the
   *  long forward arc (LOS-gated) like fireRanged. */
  function hasEnemyInRange(): boolean {
    const stats = getCurrentWeapon();
    camera.getWorldDirection(forwardDir);
    const forwardLenXZ = Math.hypot(forwardDir.x, forwardDir.z) || 1;
    if (stats.ranged) {
      const walkable = getWalkable();
      const losCheck = walkable
        ? (cx: number, cz: number, tx: number, tz: number) => walkable.hasLineOfSight(cx, cz, tx, tz)
        : undefined;
      return !!pickTarget(getEnemies(), camera, forwardDir, forwardLenXZ, RANGED_REACH, RANGED_CONE_COS, losCheck);
    }
    // Melee — base reach/cone (no combo-step or charge mul), resolved through
    // the SAME swept-capsule-vs-zone test a real swing uses, so attack-vs-interact
    // priority matches what a swing would actually connect with.
    const walkable = getWalkable();
    const losCheck = walkable
      ? (cx: number, cz: number, tx: number, tz: number) => walkable.hasLineOfSight(cx, cz, tx, tz)
      : undefined;
    const shape = swingShape(null, stats.reach, stats.coneHalfAngle, CONFIG.MELEE_HITBOX_RADIUS + CONFIG.MELEE_HITBOX_INFLATION);
    return swingHitTargets(getEnemies(), camera.position, forwardDir, shape, 1, losCheck).length > 0;
  }

  return { tick, hasEnemyInRange };
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

// (The old multi-target horizontal-cone `pickTargets` was retired with the
//  combat hit rework — enemies now resolve through swingHitEnemies (swept
//  capsule vs hurtbox zones). The single-target `pickTarget` below survives for
//  RANGED auto-aim, a different concern. See docs/COMBAT-HIT-SYSTEM.md.)

function pickTarget<T extends Damageable>(
  targets: readonly T[],
  camera: THREE.Camera,
  forwardDir: THREE.Vector3,
  forwardLenXZ: number,
  reach: number,
  cosConeHalf: number,
  /** Optional LOS predicate — called with camera + target X/Z. When provided,
   *  targets without a clear line through the walkable region (a wall is between
   *  you) are skipped. BOTH ranged auto-aim and melee swings pass it — a melee
   *  reach is long enough to poke past a thin wall, so a fully hidden enemy must
   *  not be hittable (only AoE/explosion damage, applied directly, ignores LOS). */
  hasLOS?: (cx: number, cz: number, tx: number, tz: number) => boolean,
): T | null {
  let best: T | null = null;
  let bestDistSq = Infinity;
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.position.x - camera.position.x;
    const dy = (t.position.y + t.aimHeight) - camera.position.y;
    const dz = t.position.z - camera.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    // Reach extends to the target's SURFACE (centre distance minus its
    // hitRadius). A point target (hitRadius 0) keeps the old centre check.
    const effReach = reach + (t.hitRadius ?? 0);
    if (distSq > effReach * effReach) continue;

    const horDist = Math.hypot(dx, dz);
    // Point-blank: a target pressed against (or inside) you is ALWAYS
    // hittable, regardless of facing — you'd flail at something that
    // close. Covers both the exact-overlap degenerate case and the
    // "enemy ended up adjacent / slightly behind" case (e.g. after a
    // charge), which the cone check would otherwise whiff. Without this,
    // an enemy stuck on top of you is weirdly hard to hit. The radius
    // grows with the target so a big body counts as "in your face" out to
    // its surface.
    if (horDist < POINT_BLANK_RADIUS + (t.hitRadius ?? 0)) {
      if (distSq < bestDistSq) { bestDistSq = distSq; best = t; }
      continue;
    }
    const horDot = (forwardDir.x * dx + forwardDir.z * dz) / (forwardLenXZ * horDist);
    if (horDot < cosConeHalf) continue;

    // LOS check is LAST — it's the most expensive filter, so we run
    // it only after distance + cone have culled obvious misses.
    if (hasLOS && !hasLOS(camera.position.x, camera.position.z, t.position.x, t.position.z)) continue;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = t;
    }
  }
  return best;
}
