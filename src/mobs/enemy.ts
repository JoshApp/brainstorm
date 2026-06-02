import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { applyPlayerKnockback } from '../player/knockback';
import { setPlayerInAura } from '../player/inside-aura';
import { kickShake } from '../combat/screen-shake';
import { spawnHazardField } from '../combat/hazard-field';
import { emit } from '../broadcast/event-bus';
import type { EnemySpec } from '../content/enemies';
import { ENEMY_AUDIO_SIZE, ENEMY_VOCAL_ARCHETYPE } from '../content/enemies';
import {
  resolveAbilities, firstMeleeReach, wantsCreep, ELEMENTS,
  type Ability, type AbilityAction, type Anchor, type Trigger, type Element,
} from '../content/abilities';
import { applyBuff } from '../ecs/buffs';
import { spawnAoeTelegraph, type AoeTelegraph } from '../effects/aoe-telegraph';
import { TELEGRAPH_POSES, poseValue, type TelegraphStyle } from './pose-clips';
import type { WalkableRegion } from '../level/walkable';
import type { NavGrid, Waypoint } from '../level/nav-grid';
import {
  spawn as spawnEntity,
  destroy as destroyEntity,
  get as getEntity,
  generateEntityId,
} from '../ecs/world';
import type { EntityId } from '../ecs/types';
import { buildModel } from '../ecs/build-model';
import { ITEMS } from '../content/items';
import { createPickup } from '../interactables/pickup';
import { computeDamage, setEntityCombatStats, clearEntityCombatStats, registerDamageSink, unregisterDamageSink, type DamageEvent } from '../combat/damage';
import { aggregateSpeed } from '../combat/modifiers';
import { playEnemyDeath, playEnemyWindup, playEnemyVocal, type EnemyDeathSize, type VocalArchetype } from '../audio/sfx';
import { spawnProjectile } from '../combat/projectile-pool';
import { spawnXpWisps } from '../effects/xp-wisps';
import { spawnGoldCoins } from '../effects/gold-coins';
import { raiseAlert, sampleAlert } from './alerts';
import type { Damageable } from '../combat/damageable';
import { gameRng, gameRngInt, gameRngChance } from '../engine/rng';

// Audio buckets are content data (see content/enemies.ts). These thin
// lookups apply the runtime defaults: 'medium' for an unlisted size,
// null (silent) for an unlisted voice.
function audioSizeFor(spec: EnemySpec): EnemyDeathSize {
  return ENEMY_AUDIO_SIZE[spec.id] ?? 'medium';
}

function vocalArchetypeFor(spec: EnemySpec): VocalArchetype | null {
  return ENEMY_VOCAL_ARCHETYPE[spec.id] ?? null;
}

/** Release an enemy's ECS entity + registered combat stats. Called from level
 *  teardown for mobs the player LEFT ALIVE — those never hit the death path
 *  that frees them, so without this their entity + baseline stats leak into
 *  the world map across descents. Idempotent (killed mobs already freed). */
export function disposeEnemy(e: Enemy): void {
  clearEntityCombatStats(e.entityId);
  unregisterDamageSink(e.entityId);
  destroyEntity(e.entityId);
}

// Enemy = a mob driven by its EnemySpec.
//
// Geometry/materials come from spec.model via buildModel(). This module owns
// only the behavior glue:
//   - AI state machine + perception:
//       idle → alerted → chasing → winding → striking → recovering
//                                         ↓
//                                      searching → returning → idle
//   - Per-instance presentation state (hit flash, animated emissive)
//   - World-entity bookkeeping (HP lives in the world; effects can address it)
//
// Perception:
//   - Sight cone (range + half-angle): player must be inside AND line-of-
//     sight clear (no wall in between, queried from WalkableRegion).
//   - Hearing radius: small unconditional proximity that always aggros,
//     regardless of vision.
//   - Damage taken always aggros and resets the lose-sight timer.
//
// Two nested groups:
//   - `container` handles world position + yaw (face-player lookAt)
//   - `model.group` (inside container) handles internal tilt animations
// This way the body lean during windup doesn't fight the lookAt.

export type EnemyState =
  | 'idle'        // at post, scanning, has not seen player
  | 'alerted'     // first sight — brief rear-up before committing
  | 'chasing'
  | 'winding'
  | 'striking'
  | 'recovering'
  | 'searching'   // lost sight, heading to last known position
  | 'returning';  // gave up search, walking back to post

// AI timing/feel constants are tuned in src/config.ts (CONFIG.ENEMY_AI);
// the rationale for each stays here at the use site.

// How long an enemy hesitates after first spotting the player before
// committing to chase. Sells the "I see you" moment — also gives the
// player a reaction window.
const ALERTED_DURATION = CONFIG.ENEMY_AI.ALERTED_DURATION;

// How long the enemy will search at the last-known position before giving
// up. Doesn't override per-spec loseSightTime; this is the search PHASE
// duration after sight is already lost.
const SEARCH_DURATION = CONFIG.ENEMY_AI.SEARCH_DURATION;

// Idle scan: the enemy drifts its gaze in a gentle random-walk around its
// home facing, holding still much of the time, so a roomful (especially a
// spider swarm) reads as watchful — not a row of heads slapping left-right
// in unison. Each gaze change is a SMALL step from the current angle, not a
// fresh jump across the whole arc, and the interval is jittered per enemy so
// the swarm desyncs.
const IDLE_SCAN_INTERVAL_MIN = CONFIG.ENEMY_AI.IDLE_SCAN_INTERVAL_MIN;
const IDLE_SCAN_INTERVAL_JITTER = CONFIG.ENEMY_AI.IDLE_SCAN_INTERVAL_JITTER;
const IDLE_SCAN_HALF_ARC = CONFIG.ENEMY_AI.IDLE_SCAN_HALF_ARC;
const IDLE_SCAN_STEP = CONFIG.ENEMY_AI.IDLE_SCAN_STEP;
const IDLE_SCAN_HOLD_CHANCE = CONFIG.ENEMY_AI.IDLE_SCAN_HOLD_CHANCE;

export interface Enemy extends Damageable {
  entityId: EntityId;
  /** Spec id from src/content/enemies.ts ('rat', 'skirmisher', etc.). */
  kind: string;
  /** True for boss enemies — drives the boss bar (see ui/boss-bar.ts). */
  isBoss: boolean;
  /** Boss bar display name (only meaningful when isBoss). */
  bossName: string;
  group: THREE.Group;
  /** Live alias of group.position — satisfies Damageable for the unified
   *  combat cone scan. */
  position: THREE.Vector3;
  hitTargets: THREE.Object3D[];
  alive: boolean;
  /** True after hp hit zero AND the death animation is still ticking. */
  dying: boolean;
  /** Phases through obstacles (props). Walls still block. Ghost flag. */
  phasing: boolean;
  hp: number;
  /** Spec-declared base HP. Useful for hp/max ratios in HUD/observation. */
  maxHp: number;
  /** Current AI state machine phase. */
  aiState: EnemyState;
  collisionRadius: number;
  /** Combat hit radius — swings reach the body's surface this far from
   *  `position`. Default 0 (point). See Damageable.hitRadius. */
  hitRadius: number;
  /** Height the swing cone aims at + where the damage number floats from. */
  aimHeight: number;
  /** Mobs take the full crunch + fire the player's on-hit passives. */
  hitFeedback: 'heavy';
  /** If true, the player walks through this mob (movement-only).
   *  See EnemySpec.noPlayerCollision. */
  noPlayerCollision: boolean;
  takeDamage(event: DamageEvent): number;
  update(
    dt: number,
    playerPos: THREE.Vector3,
    walkable: WalkableRegion,
    nav?: NavGrid,
  ): void;
  setDebugState(state: EnemyState, phaseTimer: number): void;
  setDebugPosition(x: number, z: number): void;
  /** Rotate the container so it faces a world point (head toward it). */
  faceWorld(x: number, z: number): void;
  /** Apply a decaying knockback impulse in world XZ direction (dirX,
   *  dirZ need not be normalised) at `speed` m/s. Used by the charge's
   *  self-recoil; available for player-hit stagger too. */
  applyKnockback(dirX: number, dirZ: number, speed: number): void;
}

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpEssenceOrigin = new THREE.Vector3();

/** Optional callback fired right after an enemy reaches 0 HP — used by
 *  the builder to spawn split-on-death offspring. Runs AFTER drops +
 *  the kill event, so any spawned children appear in the same frame's
 *  enemy list and the kill is already recorded. */
export type EnemyOnDeath = (spec: EnemySpec, deathPosition: THREE.Vector3) => void;

export function createEnemy(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  spec: EnemySpec,
  onDeath?: EnemyOnDeath,
): Enemy {
  // Container: world position + yaw to face player.
  const container = new THREE.Group();
  container.position.copy(position);

  // Built model: meshes + named parts + per-instance materials.
  const built = buildModel(spec.model);
  // Bosses loom larger — scale the visual model (gameplay reach/collision
  // stay driven by the explicit stat fields).
  if (spec.scale && spec.scale !== 1) built.group.scale.multiplyScalar(spec.scale);
  container.add(built.group);

  // Tag this container as an inspection subject — main.ts's inspect
  // block hides level siblings (walls/floor/torches/decor) but keeps
  // anything tagged here visible. Zero cost in gameplay mode; the
  // userData flag is just read in the one inspect setup branch.
  container.userData.inspectSubject = true;

  scene.add(container);

  // ── Burrowed (floor ambush) state ────────────────────────────────
  // Mobs with spec.burrowed start BURIED: the built model sits 1.2m
  // below floor (invisible) and a small dirt-mound mesh marks the
  // spot above. When the player walks within triggerDistance, the
  // model rises smoothly to y=0 and the mound shrinks away;
  // afterward the mob is a normal melee predator. While buried or
  // emerging the mob is invulnerable and inert (perception + AI +
  // takeDamage all early-return).
  type BurrowState = 'buried' | 'emerging' | 'surfaced';
  let burrowState: BurrowState = spec.burrowed ? 'buried' : 'surfaced';
  let burrowTimer = 0;
  const BURROW_DEPTH = -1.6;
  let burrowMound: THREE.Group | null = null;
  if (burrowState === 'buried') {
    // Drop the creature below the floor.
    built.group.position.y = BURROW_DEPTH;
    // Build a small dirt-mound tell at the spawn spot. Three short
    // jittered cones clustered together so it reads as disturbed
    // earth, not a perfect dome. Earth-brown matte; faint emissive
    // so it's just a hair visible against the dark floor in
    // gameplay lighting.
    burrowMound = new THREE.Group();
    const moundMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f14, roughness: 1.0,
      emissive: 0x0a0604, emissiveIntensity: 0.5,
      flatShading: true,
    });
    for (const off of [[0, 0, 0], [0.10, 0, 0.08], [-0.08, 0, 0.05], [0.02, 0, -0.10]] as const) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.08, 6), moundMat);
      cone.position.set(off[0], 0.04, off[2]);
      cone.rotation.y = Math.random() * Math.PI;
      burrowMound.add(cone);
    }
    container.add(burrowMound);
  }

  // Look up the animation targets by name. tiltPart can be either a named
  // part OR a slot (slots are pure anchors useful when an enemy has a 'rig'
  // group holding everything that should tilt together).
  const tiltPart = built.parts.get(spec.tiltPartName) ?? built.slots.get(spec.tiltPartName);
  // Jointed-arm pivots (optional). Models that declare shoulderL/R slots
  // (parented to the rig) get their arms swung by the pose-clip layer;
  // models without them fall back to body-only telegraph motion.
  const shoulderL = built.slots.get('shoulderL');
  const shoulderR = built.slots.get('shoulderR');
  const shoulderBaseLX = shoulderL ? shoulderL.rotation.x : 0;
  const shoulderBaseRX = shoulderR ? shoulderR.rotation.x : 0;
  // Hip pivots (optional) — legs swing from these as the enemy MOVES
  // (distance-driven gait, see the locomotion block in update). Models
  // without hips just slide (correct for floaters like the wraith).
  const hipL = built.slots.get('hipL');
  const hipR = built.slots.get('hipR');
  const hipBaseLX = hipL ? hipL.rotation.x : 0;
  const hipBaseRX = hipR ? hipR.rotation.x : 0;
  // Neck pivot (optional) — holds the head + eyes so it can CRANE toward
  // the player: the head tips down as the player gets close (the enemy
  // looms / fixates), eases back to neutral when calm. Yaw is already
  // handled by the body facing; this adds the pitch.
  const neck = built.slots.get('neck');
  const neckBaseX = neck ? neck.rotation.x : 0;
  let headPitch = 0;
  const flashMat = built.materials.get(spec.flashMaterialName) as THREE.MeshStandardMaterial | undefined;
  const eyeMat   = built.materials.get(spec.eyeMaterialName)   as THREE.MeshStandardMaterial | undefined;

  // Windup telegraph: eyes blaze brighter and shift toward hot red as the
  // enemy commits to a strike. We mutate the sprite halo material's color
  // (and scale) since the visible eyes are sprite billboards. The mesh
  // eye material is also mutated where it exists (rat) for consistency.
  const eyeHaloL = built.parts.get('eyeHaloL') as THREE.Sprite | undefined;
  const eyeHaloR = built.parts.get('eyeHaloR') as THREE.Sprite | undefined;
  const haloMatL = eyeHaloL?.material as THREE.SpriteMaterial | undefined;
  const haloMatR = eyeHaloR?.material as THREE.SpriteMaterial | undefined;
  const haloBaseScaleL = eyeHaloL ? eyeHaloL.scale.clone() : new THREE.Vector3(1, 1, 1);
  const haloBaseScaleR = eyeHaloR ? eyeHaloR.scale.clone() : new THREE.Vector3(1, 1, 1);
  const haloBaseColorL = haloMatL ? haloMatL.color.clone() : new THREE.Color(0xff5500);
  const haloBaseColorR = haloMatR ? haloMatR.color.clone() : new THREE.Color(0xff5500);

  const eyeBaseColor = eyeMat ? eyeMat.emissive.clone() : new THREE.Color(0xff5500);
  const eyeWindupColor = new THREE.Color(0xff1505);   // hot red at peak
  const haloWindupColor = new THREE.Color(0xffffff);  // sprite goes white-hot
  const tmpEyeColor = new THREE.Color();
  const tmpHaloColor = new THREE.Color();
  function setEyeFlare(t: number) {
    // t in [0, 1] = neutral to full windup.

    // Mesh eye material (for the rat — its eye spheres render fine).
    if (eyeMat) {
      eyeMat.emissiveIntensity = baseEyeEmissive * (1 + 7 * t);
      tmpEyeColor.copy(eyeBaseColor).lerp(eyeWindupColor, t);
      eyeMat.emissive.copy(tmpEyeColor);
    }

    // Sprite halos — the dominant visible cue on humanoid enemies.
    // Scale up by ~1.6x at peak windup; color brightens toward white.
    const haloScale = 1 + 0.6 * t;
    if (eyeHaloL && haloMatL) {
      eyeHaloL.scale.set(haloBaseScaleL.x * haloScale, haloBaseScaleL.y * haloScale, 1);
      tmpHaloColor.copy(haloBaseColorL).lerp(haloWindupColor, t * 0.75);
      // Boost overall brightness so additive blend cuts through even bright
      // background pixels (e.g. silhouetted in front of a torch).
      tmpHaloColor.multiplyScalar(1 + 1.2 * t);
      haloMatL.color.copy(tmpHaloColor);
    }
    if (eyeHaloR && haloMatR) {
      eyeHaloR.scale.set(haloBaseScaleR.x * haloScale, haloBaseScaleR.y * haloScale, 1);
      tmpHaloColor.copy(haloBaseColorR).lerp(haloWindupColor, t * 0.75);
      tmpHaloColor.multiplyScalar(1 + 1.2 * t);
      haloMatR.color.copy(tmpHaloColor);
    }
  }

  // World entity (HP + buffs).
  const entityId = generateEntityId(`enemy-${spec.id}`);
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: spec.hp, current: spec.hp },
    buffs: [],
    passives: [],
  });
  // Register combat stats so the damage pipeline knows this enemy's armor +
  // (future) damage modifiers. Defaults to 0 armor, no bonuses — fields on
  // EnemySpec override per-enemy.
  setEntityCombatStats(entityId, {
    physicalArmor: spec.physicalArmor ?? 0,
    magicArmor: spec.magicArmor ?? 0,
  });
  // Route ALL damage to this enemy (incl. DoT ticks) through takeDamage
  // so death — drops, kill event, dissolve, removal — resolves no matter
  // the source. takeDamage is a hoisted function declaration below.
  registerDamageSink(entityId, takeDamage);

  // Per-instance presentation state.
  let flashTimer = 0;
  const originalColor = flashMat ? flashMat.color.clone() : new THREE.Color();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  // Capture the flash material's base emissive intensity so the
  // damage pulse can boost it (for materials with bright emissive
  // — e.g. the king-slime's core orb — base-color lerping alone is
  // invisible because the emissive overwhelms diffuse). The pulse
  // is a multiplier applied on top during flashTimer's decay.
  const originalEmissiveIntensity = flashMat ? flashMat.emissiveIntensity : 0;
  const baseEyeEmissive = spec.baseEyeEmissive;

  // ── Glowing-core hit reaction (the king's bright 'core' orb) ───────
  // An enemy that ships a `coreGlow` sprite gets the "real core" treatment:
  // an idle heartbeat that draws the eye to the weak point, and a punchy
  // white-hot flare + scale pop + bloom on damage so a hit reads clearly
  // even through the translucent body. Plain mobs (no coreGlow) keep the
  // simple colour flash below. flashMat is the core orb's material here.
  const coreMesh = built.parts.get(spec.flashMaterialName) as THREE.Mesh | undefined;
  const coreMeshBaseScale = coreMesh ? coreMesh.scale.clone() : null;
  const coreBaseEmissive = flashMat ? flashMat.emissive.clone() : new THREE.Color();
  const coreGlow = built.parts.get('coreGlow') as THREE.Sprite | undefined;
  const coreGlowMat = coreGlow?.material as THREE.SpriteMaterial | undefined;
  const coreGlowBaseScale = coreGlow ? coreGlow.scale.clone() : null;
  const hasGlowingCore = !!coreGlow && !!flashMat && originalEmissiveIntensity > 0;
  const CORE_WHITE = new THREE.Color(0xffffff);
  const tmpCoreEmissive = new THREE.Color();
  const CORE_HIT_DECAY = 0.22;   // seconds for the hit flare/pop to fall off
  let hitPulse = 0;              // 1 on hit, decays — drives flare + pop
  let coreTime = 0;             // idle heartbeat clock

  let state: EnemyState = 'idle';
  let phaseTimer = 0;
  let aliveLocal = true;
  // ── Strike-phase timeline state ────────────────────────────────────
  // Per-step latches for the ability currently striking: stepStarted[i]
  // flips once step i's trigger fires; stepDone[i] once its action fully
  // resolves (an instant hit, a melee landing, a dash contacting, a leap
  // landing). stepEvents collects events ('jump:land') that later steps'
  // triggers wait on. All reset at strike start. Per-step, never shared —
  // so two steps can't latch each other off (the old shared-flag bug).
  let stepStarted: boolean[] = [];
  let stepDone: boolean[] = [];
  const stepEvents = new Set<string>();

  // ── Abilities ──────────────────────────────────────────────────────
  // The attack runner is fully ability-driven. Enemies without an
  // explicit `abilities` list get one default ability synthesized from
  // their legacy fields (see resolveAbilities). `currentAbility` is the
  // one being executed across winding/striking/recovering; `cooldowns`
  // tracks per-ability lockout so a charge can't fire every second.
  const abilities = resolveAbilities(spec);
  // Commit distance — the farthest range at which ANY ability triggers.
  // Beyond this the enemy just chases to close. Equals attackRange for a
  // pure melee mob, the cast range for a shooter.
  const commitDistance = abilities.reduce((m, a) => Math.max(m, a.maxRange), 0);
  let currentAbility: Ability | null = null;
  const cooldowns = new Map<string, number>();
  // AoE telegraph state — the ground marker shown during an aoe ability's
  // windup, and the world point it's locked to (resolved at strike).
  let aoeTelegraph: AoeTelegraph | null = null;
  // The locked landing/impact point — the 'lockedTarget' anchor. Snapshot
  // of the player's position when the windup begins (an aoe resolves on
  // it, a leap arcs onto it).
  const aoeTarget = new THREE.Vector3();
  // The 'landing' anchor — where the last leap touched down, for a
  // follow-up step (a puddle) to build on.
  const landing = new THREE.Vector3();
  function clearAoeTelegraph() {
    if (aoeTelegraph) { aoeTelegraph.dispose(); aoeTelegraph = null; }
  }

  // Perception state. lastSeenPos tracks the last known XZ of the player
  // for searching. Updated each frame the enemy currently has LOS.
  let aggroed = false;
  let timeSinceLOS = 0;             // seconds since enemy last had LOS to player
  const homePos = position.clone();  // post the enemy returns to when calm
  // Capture spawn yaw as "home yaw" so idle scan / returning faces back the
  // way the level placed us. Set after initial faceWorld() in builder.ts —
  // for now, read whatever rotation is on the container right now.
  let homeYaw = 0;                   // filled in on first idle-tick
  let homeYawSet = false;
  // Inside-aura state — how long the player has been inside us +
  // when the next dot tick is due. Resets to 0 when player leaves.
  let auraInsideTime = 0;
  let auraDamageTimer = 0;
  // Leap takeoff point, captured at strike start — a leap action arcs
  // from here to the locked landing zone. (Its once-only touchdown is
  // latched by the step's stepDone, like every other action.)
  const leapStart = new THREE.Vector3();
  // Idle scan yaw target — rotates in place to feel watchful.
  let scanTimer = IDLE_SCAN_INTERVAL_MIN;  // pick a new target immediately
  let scanInterval = IDLE_SCAN_INTERVAL_MIN;
  let scanTargetYaw = 0;

  // Vocalisation — positional idle/aware sound so the player hears the mob
  // before they see it. Staggered first utterance so a roomful doesn't fire
  // in unison; the global throttle in sfx caps overlap.
  const vocalArch = vocalArchetypeFor(spec);
  let vocalTimer = 2 + gameRng() * 8;
  // Last position we saw the player at. Used by 'searching' state.
  const lastSeenPos = new THREE.Vector3();

  // Per-spec aggro params with defaults.
  const sightRange = spec.sightRange ?? 7;
  const sightRangeSq = sightRange * sightRange;
  const sightConeCos = Math.cos(spec.sightConeHalfAngle ?? 1.05);
  const hearingRange = spec.hearingRange ?? 2.5;
  const hearingRangeSq = hearingRange * hearingRange;
  const loseSightTime = spec.loseSightTime ?? 4;

  // Idle-state eye appearance: dim mesh emissive AND dim sprite halo. The
  // setEyeFlare(0) path is for windup-reset and goes back to FULL base
  // brightness, which is what aggroed-but-idle-frame should look like —
  // not what we want for a truly unaware mob.
  function applyIdleEyes() {
    // Tuned against the PSX bloom pipeline — 0.45/0.4 multipliers still
    // read as full-bright at distance. These low values give a faint
    // "watching pinprick" feel: visible enough to know something's there,
    // dim enough to read as unaware. Idle should be unsettling, not threatening.
    if (eyeMat) eyeMat.emissiveIntensity = baseEyeEmissive * 0.18;
    if (eyeHaloL && haloMatL) {
      eyeHaloL.scale.set(haloBaseScaleL.x * 0.55, haloBaseScaleL.y * 0.55, 1);
      haloMatL.color.copy(haloBaseColorL).multiplyScalar(0.15);
    }
    if (eyeHaloR && haloMatR) {
      eyeHaloR.scale.set(haloBaseScaleR.x * 0.55, haloBaseScaleR.y * 0.55, 1);
      haloMatR.color.copy(haloBaseColorR).multiplyScalar(0.15);
    }
  }
  // Apply immediately so unseen enemies don't pop with full-bright eyes
  // on the very first frame (before update runs even once).
  applyIdleEyes();
  // Per-cycle randomized windup duration so multiple enemies attacking in
  // unison de-synchronize over time (otherwise stacked mobs all strike on
  // the exact same frame and the player has no rhythm to read).
  let currentWindupTime = abilities[0].windup;
  function rollWindupTime() {
    const base = currentAbility?.windup ?? abilities[0].windup;
    currentWindupTime = base * (0.78 + gameRng() * 0.44);  // ±22%
  }
  rollWindupTime();

  // Presence — continuous animation overlay applied each frame on top of
  // the per-state animation. Per-instance phase offset so two of the same
  // mob drift out of sync. Cost = a couple of sin() per mob per frame.
  const presence = spec.presence;
  const presencePhase = Math.random() * Math.PI * 2;
  let presenceTime = 0;

  // Locomotion (gait) — drives the hip pivots from ACTUAL movement so
  // legs swing in step with travel instead of the body moonwalking. The
  // stride phase advances by distance covered (auto-syncs to real
  // speed); gait amplitude eases in when moving, out when stopped so
  // legs settle to rest. Only does anything on models with hip pivots.
  let prevX = container.position.x;
  let prevZ = container.position.z;
  let stridePhase = Math.random() * Math.PI * 2;   // desync mobs
  let gaitAmp = 0;
  const STRIDE_LENGTH = 0.7;   // metres per full leg cycle
  const GAIT_SWING = 0.5;      // peak hip rotation (rad) at full gait

  // Knockback — a short decaying impulse on the enemy's position,
  // applied on top of (and overriding) AI movement each frame. Used by
  // the charge to recoil off the player on contact; also exposed so the
  // player's melee hits can stagger enemies later. Walls clamp it.
  let knockVX = 0;
  let knockVZ = 0;
  const KNOCKBACK_CHARGE = 4.5;   // recoil speed when a charge connects
  function applyKnockback(dirX: number, dirZ: number, speed: number) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-5) return;
    knockVX = (dirX / len) * speed;
    knockVZ = (dirZ / len) * speed;
  }
  // 'chant' needs a reference to the orb material so the pulse can drive
  // its emissive intensity. Grabbed once at build; null for non-chant.
  const orbMat = presence === 'chant'
    ? (built.materials.get('orb') as THREE.MeshStandardMaterial | undefined)
    : undefined;
  const orbBaseEmissive = orbMat?.emissiveIntensity ?? 0;

  // Pathfinding state — cached waypoints to the current target. Refreshed
  // every PATH_REFRESH seconds while LOS to the target is blocked. Phasing
  // mobs (wraith) skip pathfinding entirely; they steer through props.
  let path: Waypoint[] = [];
  let pathTime = 0;
  const PATH_REFRESH = 0.5;
  const WAYPOINT_REACHED_SQ = 0.35 * 0.35;

  /**
   * Steer toward a world target, routing around obstacles via the nav
   * grid when there's no line-of-sight. Centralized so every state that
   * moves (chasing, searching, returning, winding) gets the same
   * "doesn't get stuck on pillars" behavior. For phasing mobs the
   * pathfinder is bypassed — they just steer directly and pass through
   * props (walls still block them through clampMove's ignoreObstacles).
   */
  function moveTowards(
    targetX: number, targetZ: number, speed: number, dt: number,
    walkable: WalkableRegion, nav?: NavGrid,
  ) {
    let mx = targetX;
    let mz = targetZ;
    if (!spec.phasing && nav) {
      // includeObstacles: pillars + altars + fountains BLOCK movement
      // even though they don't block perception. Without this the mob
      // sees clear LOS through a pillar, beelines, and clampMove pins
      // it against the pillar's edge.
      const directLOS = walkable.hasLineOfSight(
        container.position.x, container.position.z, targetX, targetZ,
        { includeObstacles: true },
      );
      if (!directLOS) {
        // Invalidate the cached path if the target drifted significantly
        // from where we last planned to (player moved across the room).
        if (path.length > 0) {
          const last = path[path.length - 1];
          const tdx = targetX - last.x;
          const tdz = targetZ - last.z;
          if (tdx * tdx + tdz * tdz > 2.25) {
            path.length = 0;
            pathTime = 0;
          }
        }
        pathTime += dt;
        if (pathTime >= PATH_REFRESH || path.length === 0) {
          path = nav.findPath(container.position.x, container.position.z, targetX, targetZ);
          pathTime = 0;
        }
        // Walk the waypoint queue, popping any we've already reached.
        while (path.length > 0) {
          const wp = path[0];
          const dwx = wp.x - container.position.x;
          const dwz = wp.z - container.position.z;
          if (dwx * dwx + dwz * dwz < WAYPOINT_REACHED_SQ) {
            path.shift();
          } else {
            mx = wp.x;
            mz = wp.z;
            break;
          }
        }
      } else {
        // We can see the target — drop any stale path so we beeline.
        pathTime = 0;
        path.length = 0;
      }
    }

    const dx = mx - container.position.x;
    const dz = mz - container.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 1e-6) return;
    const inv = 1 / Math.sqrt(distSq);
    const step = speed * dt;
    const newX = container.position.x + dx * inv * step;
    const newZ = container.position.z + dz * inv * step;
    const resolved = walkable.clampMove(
      container.position.x, container.position.z,
      newX, newZ,
      spec.collisionRadius,
      spec.phasing ? { ignoreObstacles: true } : undefined,
    );
    container.position.x = resolved.x;
    container.position.z = resolved.z;
  }

  // Death sequence — once hp hits zero we DON'T immediately remove the
  // mesh. We ramp a dissolve uniform 0→1 over DEATH_DURATION while
  // additive soul wisps drift up + the body lifts. Only when the timer
  // expires does the container leave the scene.
  const DEATH_DURATION = 0.55;
  let deathTimer = -1;   // -1 = not dying; >=0 = ticking
  // Pre-collect every dissolve uniform we need to drive. Walking
  // `built.materials` per-frame would work too, but caching the refs
  // here keeps the per-frame tick branch-free.
  const dissolveUniforms: Array<{ value: number }> = [];
  for (const m of built.materials.values()) {
    const u = m.userData.uDissolve as { value: number } | undefined;
    if (u) dissolveUniforms.push(u);
  }
  // Essence-emit counter — how many XP particles have been spawned out
  // of the dissolving body so far. tickDying spawns them incrementally
  // as the dissolve progresses, not all at once at death moment.
  let essenceSpawned = 0;
  let essenceTotal = 0;
  let essenceRigY = 0;

  /**
   * Apply incoming damage. Takes a DamageEvent and routes through the
   * pipeline (computes final after this enemy's armor for the type),
   * then mutates HP and fires presentation effects.
   *
   * Returns the actual amount applied (caller can use for damage numbers).
   */
  function takeDamage(event: DamageEvent): number {
    if (!aliveLocal) return 0;
    // Buried/emerging mobs can't be hit — the creature itself is
    // underground or mid-burst, not yet a valid target. Routes
    // through here normally; we short-circuit before HP changes.
    if (burrowState !== 'surfaced') return 0;
    const entity = getEntity(entityId);
    if (!entity || !entity.hp) return 0;
    const result = computeDamage(event);
    entity.hp.current = Math.max(0, entity.hp.current - result.applied);
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
    hitPulse = 1;   // drives the glowing-core flare + pop (king)
    // Damage from any source aggros (and keeps aggro for the full
    // loseSightTime window after the hit, even if the player breaks LOS
    // — a wounded mob doesn't forget). If we were idle/searching/etc,
    // jump straight to chasing (skip the alerted hesitation — being hit
    // IS the wake-up).
    aggroed = true;
    timeSinceLOS = 0;
    if (state === 'idle' || state === 'alerted' || state === 'searching' || state === 'returning') {
      state = 'chasing';
      phaseTimer = 0;
    }
    if (entity.hp.current <= 0) {
      // Killed mid-windup — drop any pending AoE marker so it doesn't
      // linger on the floor after the caster is gone.
      clearAoeTelegraph();
      // Mark dead immediately for combat/gameplay purposes (no more
      // damage, no AI ticks, kill counter triggers, drops spawn). The
      // container stays in the scene for the duration of the death
      // animation — the dissolve uniform + soul wisps run via the
      // dying-branch in update(). Final scene.remove happens when
      // deathTimer crosses DEATH_DURATION.
      aliveLocal = false;
      clearEntityCombatStats(entityId);
      unregisterDamageSink(entityId);
      destroyEntity(entityId);
      playEnemyDeath(audioSizeFor(spec), container.position);
      // Drop table: each entry rolls independently. Multiple successful
      // drops are spread in a small arc around the death position so they
      // don't stack on the same pixel.
      if (spec.drops) {
        const drops: string[] = [];
        if (spec.drops.guaranteed) drops.push(...spec.drops.guaranteed);
        const rate = spec.drops.rate ?? 0.3;
        if (gameRngChance(rate) && spec.drops.pool && spec.drops.pool.length > 0) {
          const total = spec.drops.pool.reduce((s, e) => s + e.weight, 0);
          let r = gameRng() * total;
          for (const entry of spec.drops.pool) {
            r -= entry.weight;
            if (r <= 0) {
              drops.push(entry.itemId);
              break;
            }
          }
        }
        const N = drops.length;
        // Loot fountain — each item pops out of the corpse on its own arc.
        drops.forEach((itemId, i) => {
          const item = ITEMS[itemId];
          if (!item) return;
          const pos = container.position.clone();
          const angle = (N > 1 ? (i / N) * Math.PI * 2 : Math.random() * Math.PI * 2)
            + (Math.random() - 0.5) * 0.6;
          const horizontalSpeed = 1.4 + Math.random() * 0.6;
          const verticalSpeed = 3.6 + Math.random() * 0.5;
          const launchVel = new THREE.Vector3(
            Math.cos(angle) * horizontalSpeed,
            verticalSpeed,
            Math.sin(angle) * horizontalSpeed,
          );
          createPickup(scene, pos, item, { velocity: launchVel });
        });
      }
      // Clear raycast targets so a swing mid-dissolve doesn't generate a
      // zero-damage "hit" on the disintegrating corpse.
      built.hitTargets.length = 0;
      emit({ type: 'enemy:killed', enemyId: spec.id });
      // Split-on-death — fire the builder's spawn callback so any
      // children appear in the same frame's enemy list. Pass a CLONE
      // of the death position because the builder may need it after
      // we've moved on (and clone is cheap).
      if (onDeath) onDeath(spec, container.position.clone());
      // Start the death animation. Essence emits CONTINUOUSLY during
      // the dissolve — see tickDying. Gold coins drop now as physical
      // floor pickups with bundled value.
      deathTimer = 0;
      essenceRigY = spec.model.slots?.rig?.pos[1] ?? 0.6;
      essenceTotal = spec.xp ?? 1;
      essenceSpawned = 0;
      // Gold coins — bundled into 1–3 chunky drops. The roll picks a
      // TOTAL gold amount once; the coin module decides how to split it.
      const goldRange = spec.gold;
      if (goldRange) {
        const min = goldRange[0];
        const max = goldRange[1];
        const amt = gameRngInt(min, max);
        if (amt > 0) {
          const coinOrigin = container.position.clone();
          coinOrigin.y += essenceRigY * 0.55;
          spawnGoldCoins(scene as THREE.Object3D, coinOrigin, amt);
        }
      }
    }
    return result.applied;
  }

  function distToXZ(target: THREE.Vector3): number {
    const dx = container.position.x - target.x;
    const dz = container.position.z - target.z;
    return Math.hypot(dx, dz);
  }

  function faceTarget(target: THREE.Vector3) {
    // Three.js Object3D.lookAt() (for non-cameras) makes the object's +Z
    // axis face the target. Our models follow the OPPOSITE convention —
    // head/eyes/snout at -Z, tail/back at +Z (matching camera convention)
    // — so we add π to the yaw after lookAt so the model's -Z (head)
    // faces the target instead of its +Z (back).
    tmpFlat.set(target.x, container.position.y, target.z);
    container.lookAt(tmpFlat);
    container.rotation.y += Math.PI;
  }

  function applyTilt(angle: number) {
    if (tiltPart) tiltPart.rotation.x = angle;
  }

  function setEyeEmissive(intensity: number) {
    if (eyeMat) eyeMat.emissiveIntensity = intensity;
  }
  // (setEyeFlare lives above — combines intensity ramp + color shift.)

  // ── Ability runner helpers ─────────────────────────────────────────

  /** Pick the highest-priority ready ability whose range band contains
   *  `distance`. null if none is ready/in-band (caller then steers). */
  function selectAbility(distance: number): Ability | null {
    for (const ab of abilities) {
      if ((cooldowns.get(ab.id) ?? 0) > 0) continue;
      const min = ab.minRange ?? 0;
      if (distance >= min && distance <= ab.maxRange) return ab;
    }
    return null;
  }

  /** Telegraph + strike pose per ability flavour, driven by phase
   *  progress t (0..1). Data-driven via TELEGRAPH_POSES (pose-clips.ts):
   *  body lean + rise on every enemy, plus an arm swing on models that
   *  have shoulder pivots (graceful no-op otherwise). Eye flare ramps
   *  with the windup, holds at strike, fades over recover. */
  function applyTelegraph(style: Ability['pose'], phase: 'windup' | 'strike' | 'recover', t: number) {
    const pose = TELEGRAPH_POSES[(style ?? 'swing') as TelegraphStyle];
    applyTilt(poseValue(pose.rigTilt, phase, t));
    built.group.position.y = poseValue(pose.bob, phase, t);
    const arm = poseValue(pose.armSwing, phase, t);
    if (shoulderL) shoulderL.rotation.x = shoulderBaseLX + arm;
    if (shoulderR) shoulderR.rotation.x = shoulderBaseRX + arm;
    setEyeFlare(phase === 'windup' ? t : phase === 'strike' ? 1 : 1 - t);
  }

  /** Apply this enemy's on-hit status to the player, if it has one and
   *  the roll succeeds. Called after any strike that damages the player
   *  (melee + dash contact). Sourced to this enemy for kill attribution. */
  function inflictOnHit() {
    const oh = spec.onHit;
    if (!oh || !gameRngChance(oh.chance)) return;
    const player = getEntity('player');
    if (player) applyBuff(player, oh.buffId, oh.duration, entityId);
  }

  /** Resolve an anchor to a world XZ. self/player are live; lockedTarget
   *  is the snapshot taken at windup start (aoeTarget); landing is written
   *  by a leap on touchdown. */
  function resolveAnchor(a: Anchor, playerPos: THREE.Vector3): { x: number; z: number } {
    switch (a) {
      case 'self':         return { x: container.position.x, z: container.position.z };
      case 'lockedTarget': return { x: aoeTarget.x, z: aoeTarget.z };
      case 'landing':      return { x: landing.x, z: landing.z };
      default:             return { x: playerPos.x, z: playerPos.z };   // 'player'
    }
  }

  /** Face a world XZ (head toward it) — see faceTarget for the convention. */
  function faceXZ(x: number, z: number) {
    tmpFlat.set(x, container.position.y, z);
    container.lookAt(tmpFlat);
    container.rotation.y += Math.PI;
  }

  /** Damage type for an action's element (the element table is the single
   *  source — physical/arcane carry no status). */
  function dmgTypeOf(element?: Element) {
    return ELEMENTS[element ?? 'physical'].damageType;
  }

  /** Run one ability action this frame. Returns true when the action is
   *  DONE (no more per-frame work): an instant hit resolves once; a melee
   *  keeps trying until it lands or the strike ends; dash/leap run their
   *  whole motion. Each action owns its own resolution — nothing is shared
   *  between steps (that sharing is what broke the old leap). */
  function runAction(
    action: AbilityAction,
    ability: Ability,
    stepId: string | undefined,
    playerPos: THREE.Vector3,
    distance: number,
    dt: number,
    walkable: WalkableRegion,
    nav?: NavGrid,
  ): boolean {
    switch (action.kind) {
      case 'melee': {
        if (distance <= action.reach) {
          damagePlayer(action.damage, entityId, dmgTypeOf(action.element));
          inflictOnHit();
          return true;            // hit — done
        }
        return false;             // keep trying within the strike window
      }
      case 'projectile': {
        tmpMuzzle.set(action.muzzle[0], action.muzzle[1], action.muzzle[2]);
        container.updateMatrixWorld();
        tmpMuzzle.applyMatrix4(container.matrixWorld);
        const t = resolveAnchor(action.toward ?? 'player', playerPos);
        tmpTarget.set(t.x, tmpMuzzle.y, t.z);
        spawnProjectile({
          typeId: action.projectileId, origin: tmpMuzzle, target: tmpTarget,
          damage: action.damage, source: entityId,
        });
        return true;
      }
      case 'dash': {
        // Lunge until contact (or the strike runs out). The moment it
        // connects we hit + recoil OFF the player and stop driving forward,
        // so the charger doesn't end up stuck inside you.
        const tgt = resolveAnchor(action.toward, playerPos);
        moveTowards(tgt.x, tgt.z, action.speed, dt, walkable, nav);
        if (distance <= action.contactReach) {
          damagePlayer(action.damage, entityId, dmgTypeOf(action.element));
          inflictOnHit();
          applyKnockback(
            container.position.x - playerPos.x,
            container.position.z - playerPos.z,
            KNOCKBACK_CHARGE,
          );
          return true;            // contact — stop dashing
        }
        return false;
      }
      case 'aoe': {
        // Resolve against the action's origin (lockedTarget snapshot, or
        // self) — the player dodges by leaving the marked circle.
        const o = resolveAnchor(action.origin, playerPos);
        const dx = playerPos.x - o.x;
        const dz = playerPos.z - o.z;
        if (dx * dx + dz * dz <= action.radius * action.radius) {
          damagePlayer(action.damage, entityId, dmgTypeOf(action.element));
        }
        clearAoeTelegraph();
        return true;
      }
      case 'leap': {
        // Committed airborne jump: deterministic interpolation from takeoff
        // (leapStart) to the LOCKED landing zone, synced to a parabolic arc,
        // so the king touches down exactly on the marker. Self-contained;
        // never shares state, so it runs the whole strike.
        const strike = ability.strike > 0 ? ability.strike : 1;
        const t = Math.min(1, phaseTimer / strike);
        const dest = resolveAnchor(action.toward, playerPos);
        // Cap the travel to maxDistance from takeoff (a small chase hop),
        // else the arc covers the full gap in one leap.
        if (action.maxDistance) {
          const ddx = dest.x - leapStart.x;
          const ddz = dest.z - leapStart.z;
          const dd = Math.hypot(ddx, ddz);
          if (dd > action.maxDistance) {
            dest.x = leapStart.x + (ddx / dd) * action.maxDistance;
            dest.z = leapStart.z + (ddz / dd) * action.maxDistance;
          }
        }

        // Horizontal: ease to arrive OVER the marker by ~the apex, then
        // hold — so the back half reads as a committed vertical drop onto
        // the locked spot, not a glide.
        const riseFrac = action.riseFraction ?? 0.5;
        const hu = Math.min(1, t / Math.min(0.85, riseFrac + 0.2));
        const he = hu * hu * (3 - 2 * hu);               // smoothstep
        const tx = leapStart.x + (dest.x - leapStart.x) * he;
        const tz = leapStart.z + (dest.z - leapStart.z) * he;
        const resolved = walkable.clampMove(
          container.position.x, container.position.z, tx, tz,
          spec.collisionRadius,
          spec.phasing ? { ignoreObstacles: true } : undefined,
        );
        container.position.x = resolved.x;
        container.position.z = resolved.z;

        // Vertical: rise fast (ease into a brief hang at the apex), then a
        // gentle smoothstep descent with a soft landing — riseFrac < 0.5
        // stretches the drop so the player can read it and dodge off.
        let vy: number;
        if (t <= riseFrac) {
          const u = riseFrac > 0 ? t / riseFrac : 1;
          vy = Math.sin(u * Math.PI / 2);                // 0→1, decelerates into the apex
        } else {
          const u = (t - riseFrac) / (1 - riseFrac);     // 0→1 over the descent
          vy = 1 - u * u * (3 - 2 * u);                  // 1→0, slow-fast-slow (soft landing)
        }
        container.position.y = action.arcHeight * vy;
        faceXZ(dest.x, dest.z);

        if (t >= 1) {
          container.position.y = 0;
          // Write the landing anchor so a follow-up step (a puddle) can
          // build on the impact point, and emit the 'land' event.
          landing.set(container.position.x, 0, container.position.z);
          if (action.shake) kickShake(action.shake, action.shakeDuration ?? 0.4);
          const dx = playerPos.x - container.position.x;
          const dz = playerPos.z - container.position.z;
          if (dx * dx + dz * dz <= action.landingRadius * action.landingRadius) {
            damagePlayer(action.damage, entityId, dmgTypeOf(action.element));
            inflictOnHit();
            if (action.knockbackSpeed) applyPlayerKnockback(dx, dz, action.knockbackSpeed);
          }
          clearAoeTelegraph();
          if (stepId) stepEvents.add(stepId + ':land');
          return true;            // landed — done
        }
        return false;
      }
      case 'field': {
        // Drop a persistent hazard field at the resolved origin (e.g. the
        // king's leap spilling an acid puddle at its `landing` point). It
        // ticks independently from here on — outliving this cast — and its
        // DoT is credited to this enemy.
        const o = resolveAnchor(action.origin, playerPos);
        spawnHazardField(scene, {
          x: o.x, z: o.z, radius: action.radius, lifetime: action.lifetime,
          slow: action.slow, dps: action.dps, dotInterval: action.dotInterval,
          damageType: dmgTypeOf(action.element), source: entityId,
          color: action.element === 'fire' ? 0xff5a1e
            : action.element === 'frost' ? 0x6ab8ff
            : 0x6abf2a,   // acid / default green
        });
        return true;
      }
    }
  }

  /** True when a step's trigger condition holds this frame. */
  function triggerMet(trigger: Trigger, clock: number): boolean {
    if ('at' in trigger) return clock >= trigger.at;
    return stepEvents.has(trigger.after + ':' + trigger.on);
  }

  /** At windup start: snapshot the locked target (the 'lockedTarget'
   *  anchor) and raise the spatial ground ring for the ability's first
   *  aoe/leap action — its "stand here and you eat it" tell. Melee/dash/
   *  projectile abilities have no ground ring (the pose is the tell). A
   *  leap clamps its landing zone outward to minDistance so a player
   *  hugging the body still gets a real arc. */
  function setupAbilityTelegraph(ability: Ability, playerPos: THREE.Vector3) {
    aoeTarget.set(playerPos.x, 0, playerPos.z);
    clearAoeTelegraph();
    for (const step of ability.steps) {
      const a = step.action;
      if (a.kind === 'aoe') {
        const o = a.origin === 'self'
          ? { x: container.position.x, z: container.position.z }
          : { x: aoeTarget.x, z: aoeTarget.z };
        aoeTelegraph = spawnAoeTelegraph(scene, o.x, o.z, a.radius);
        return;
      }
      // Only a COMMITTED leap (onto the locked target) telegraphs a
      // landing ring — that's the "step off the marker" attack. A homing
      // hop (toward 'player') is just chase movement; no ring.
      if (a.kind === 'leap' && a.toward === 'lockedTarget') {
        const minD = a.minDistance ?? 0;
        const dx = aoeTarget.x - container.position.x;
        const dz = aoeTarget.z - container.position.z;
        const d = Math.hypot(dx, dz);
        if (minD > 0 && d < minD) {
          const dir = d > 1e-4
            ? { x: dx / d, z: dz / d }
            : { x: Math.sin(container.rotation.y), z: -Math.cos(container.rotation.y) };
          aoeTarget.set(
            container.position.x + dir.x * minD, 0,
            container.position.z + dir.z * minD,
          );
        }
        aoeTelegraph = spawnAoeTelegraph(scene, aoeTarget.x, aoeTarget.z, a.landingRadius);
        return;
      }
    }
  }

  // Perception check. Returns true if the enemy can detect the player
  // right now, via either:
  //   - Hearing (proximity inside hearingRange, ignores cone + LOS)
  //   - Sight (inside sightRange, inside cone, AND clear LOS to player)
  // Hearing wins ties — close enough always trips, regardless of facing.
  function canSeePlayer(playerPos: THREE.Vector3, walkable: WalkableRegion): boolean {
    const dx = playerPos.x - container.position.x;
    const dz = playerPos.z - container.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < hearingRangeSq) return true;
    if (distSq > sightRangeSq) return false;
    // Cone check (uses current container yaw — the enemy's facing).
    // Container facing: container's "forward" is -Z in local space (per
    // the lookAt convention we set in faceTarget). Convert to world.
    const dist = Math.sqrt(distSq);
    const ndx = dx / dist;
    const ndz = dz / dist;
    const forwardX = -Math.sin(container.rotation.y);
    const forwardZ = -Math.cos(container.rotation.y);
    const dot = forwardX * ndx + forwardZ * ndz;
    if (dot < sightConeCos) return false;
    // LOS — straight line, blocked by walls only (not pillars/altar).
    return walkable.hasLineOfSight(
      container.position.x, container.position.z,
      playerPos.x, playerPos.z,
    );
  }

  function tickDying(dt: number) {
    deathTimer += dt;
    const t = Math.min(1, deathTimer / DEATH_DURATION);

    // Drive the dissolve uniform on every dissolvable material on the
    // mob. The shader injection (build-model.ts attachShaderExtensions)
    // converts uDissolve into a top-down ragged discard with an
    // emissive edge band.
    for (const u of dissolveUniforms) u.value = t;

    // Body lifts as the soul leaves — spectral enemies rise more (sells
    // the float), physical creatures sag a touch.
    const lift = presence === 'spectral'
      ?  0.55 * t
      : -0.08 * t;
    built.group.position.y = lift;

    // Eye flare — spike then crash. The mob "sees clearly" the instant
    // it dies, then the lights go out before the body is gone.
    const eyeT = t < 0.18
      ?  t / 0.18
      :  1 - (t - 0.18) / 0.82;
    setEyeFlare(Math.max(0, eyeT));

    // Halo opacity fades alongside.
    if (haloMatL) haloMatL.opacity = Math.max(0, 1 - t);
    if (haloMatR) haloMatR.opacity = Math.max(0, 1 - t);

    // Essence emission — spawn XP motes incrementally during the
    // dissolve so the body visibly becomes essence flowing into the
    // player. Origin tracks the dissolve "front" (rises with t) so
    // motes appear from the still-visible portion of the body.
    if (essenceTotal > 0) {
      const target = Math.floor(t * essenceTotal);
      const dissolveFrontY = container.position.y + essenceRigY * (0.4 + (1 - t) * 0.8);
      while (essenceSpawned < target && essenceSpawned < essenceTotal) {
        const ox = container.position.x;
        const oz = container.position.z;
        tmpEssenceOrigin.set(ox, dissolveFrontY, oz);
        spawnXpWisps(scene as THREE.Object3D, tmpEssenceOrigin, 1);
        essenceSpawned++;
      }
    }

    if (t >= 1) {
      // Catch any straggler XP that the integer-floor schedule missed
      // (e.g. essenceTotal=5 but we only spawned 4 because t hit 1.0
      // exactly on the same frame).
      while (essenceSpawned < essenceTotal) {
        tmpEssenceOrigin.set(
          container.position.x,
          container.position.y + essenceRigY * 0.4,
          container.position.z,
        );
        spawnXpWisps(scene as THREE.Object3D, tmpEssenceOrigin, 1);
        essenceSpawned++;
      }
      // Animation complete — remove the container and mark fully done.
      scene.remove(container);
      deathTimer = -1;
      // Dispose the geometries we built for this mob. Materials are
      // safe to leak (the program cache key dedup means subsequent
      // spawns hit the cached compile).
      built.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
    }
  }

  // ── Per-frame animation/audio overlays ──────────────────────────────
  // Cosmetic + audio steps that run every aware/active frame regardless of
  // AI state. Pulled out of update() so the state machine reads clean; each
  // is a nested closure so it keeps direct access to the model refs.

  // Emit a positional vocalisation in "living its life" states (not
  // mid-attack). Agitated when hunting; calm + sparse at post.
  function tickVocalisation(dt: number) {
    if (!vocalArch) return;
    vocalTimer -= dt;
    if (vocalTimer > 0) return;
    const agitated = state === 'chasing' || state === 'searching';
    const canVocalize = state === 'idle' || state === 'returning' || agitated;
    if (canVocalize) {
      playEnemyVocal(vocalArch, container.position, agitated);
      vocalTimer = agitated ? 2.5 + gameRng() * 3 : 7 + gameRng() * 10;
    } else {
      vocalTimer = 1.5;   // mid-attack — retry shortly
    }
  }

  // Tip the head toward the player when aware — stronger the closer they
  // are. Eases back to neutral when idle/returning. No-op without a neck.
  function tickHeadCrane(dt: number, distance: number) {
    if (!neck) return;
    const aware = aggroed && state !== 'returning';
    const prox = Math.max(0, 1 - distance / 5);   // 0 far → 1 point-blank
    const targetPitch = aware ? -0.45 * prox : 0;
    headPitch += (targetPitch - headPitch) * Math.min(1, dt * 6);
    neck.rotation.x = neckBaseX + headPitch;
  }

  // Integrate + decay the recoil impulse, clamped against walls. Runs after
  // AI movement so a connected charge recoils. Fast decay → a brief shove.
  function tickKnockback(dt: number, walkable: WalkableRegion) {
    if (knockVX === 0 && knockVZ === 0) return;
    const r = walkable.clampMove(
      container.position.x, container.position.z,
      container.position.x + knockVX * dt,
      container.position.z + knockVZ * dt,
      spec.collisionRadius,
      spec.phasing ? { ignoreObstacles: true } : undefined,
    );
    container.position.x = r.x;
    container.position.z = r.z;
    const decay = Math.exp(-dt * 9);
    knockVX *= decay;
    knockVZ *= decay;
    if (Math.abs(knockVX) < 0.05 && Math.abs(knockVZ) < 0.05) { knockVX = 0; knockVZ = 0; }
  }

  // Swing the legs from how far the body actually moved this frame, so a
  // walking enemy plants strides instead of sliding. No-op on floaters /
  // non-humanoids (no hip pivots).
  function tickLocomotion(dt: number) {
    if (hipL || hipR) {
      const movedX = container.position.x - prevX;
      const movedZ = container.position.z - prevZ;
      const moved = Math.hypot(movedX, movedZ);
      // Advance the cycle by distance covered → feet roughly track the
      // ground, less moonwalk than a time-based cycle.
      stridePhase += (moved / STRIDE_LENGTH) * Math.PI * 2;
      // Ease gait in/out so legs return to rest when the enemy stops
      // (a frozen mid-stride pose reads worse than settling to neutral).
      const targetAmp = moved > 0.0005 ? GAIT_SWING : 0;
      gaitAmp += (targetAmp - gaitAmp) * Math.min(1, dt * 9);
      const swing = Math.sin(stridePhase) * gaitAmp;
      if (hipL) hipL.rotation.x = hipBaseLX + swing;
      if (hipR) hipR.rotation.x = hipBaseRX - swing;
      // Subtle vertical bob synced to the stride (up on each footfall).
      built.group.position.y += Math.abs(Math.sin(stridePhase)) * gaitAmp * 0.05;
    }
    prevX = container.position.x;
    prevZ = container.position.z;
  }

  // Idle "alive" overlay applied AFTER the state animation so it stacks on
  // what the state set. position.y + container yaw are written by state code
  // (so presence ADDS); built.group x/z + roll are untouched (writes direct).
  function tickPresenceOverlay(dt: number) {
    if (!presence) return;
    presenceTime += dt;
    const t = presenceTime + presencePhase;
    switch (presence) {
      case 'spectral': {
        // Slow vertical bob + micro yaw sway. Wraith — float + drift.
        built.group.position.y += Math.sin(t * 1.7) * 0.10;
        container.rotation.y   += Math.sin(t * 0.9) * 0.05;
        break;
      }
      case 'lurch': {
        // Shambling corpse — lateral roll with a shamble-step dip
        // synced to the roll. Reads as heavy + off-balance.
        built.group.rotation.z  = Math.sin(t * 1.45) * 0.08;
        built.group.position.y += Math.abs(Math.sin(t * 1.45)) * 0.05 - 0.025;
        break;
      }
      case 'twitch': {
        // Rat — fast yaw micro-shudder + scurry bob. Yaw is on
        // container so the whole body twitches, not just the head.
        container.rotation.y   += Math.sin(t * 7.0) * 0.045;
        built.group.position.y += Math.abs(Math.sin(t * 8.5)) * 0.012;
        break;
      }
      case 'coiled': {
        // Skirmisher — taut shoulder bob + subtle weight-shift roll.
        // Reads as ready to spring rather than at rest.
        built.group.position.y += Math.sin(t * 2.4) * 0.022;
        built.group.rotation.z  = Math.sin(t * 1.7) * 0.030;
        break;
      }
      case 'chant': {
        // Acolyte — slow ritual side rock + horizontal drift + orb
        // emissive pulse. The orb pulse is what sells "channelling"
        // even when the caster is just standing.
        built.group.rotation.z  = Math.sin(t * 1.0) * 0.08;
        built.group.position.x  = Math.sin(t * 0.8) * 0.025;
        if (orbMat) {
          orbMat.emissiveIntensity = orbBaseEmissive * (1 + 0.35 * Math.sin(t * 1.4));
        }
        break;
      }
    }
  }

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid) {
    if (!aliveLocal) {
      // Dying branch — run the death animation; everything else (AI,
      // perception, movement) is gated off.
      if (deathTimer >= 0) tickDying(dt);
      return;
    }

    // ── Burrowed (pre-emerge gate) ─────────────────────────────────
    // While buried, the mob is inert: no perception, no AI, no
    // damage. The ONLY thing it watches is the player's distance to
    // the burrow spot. When close enough, flip to emerging.
    if (burrowState === 'buried') {
      const dx = playerPos.x - container.position.x;
      const dz = playerPos.z - container.position.z;
      const dist2 = dx * dx + dz * dz;
      const trigger = spec.burrowed!.triggerDistance;
      if (dist2 < trigger * trigger) {
        burrowState = 'emerging';
        burrowTimer = 0;
      }
      return;
    }
    if (burrowState === 'emerging') {
      // Ease-out rise from BURROW_DEPTH to 0, plus a quick mound-
      // shrink so the dirt visibly bursts apart. emergeTime is short
      // (~0.4s) so the motion reads as an ambush, not a slow elevator.
      burrowTimer += dt;
      const emergeTime = spec.burrowed!.emergeTime;
      const t = Math.min(1, burrowTimer / emergeTime);
      const ease = 1 - (1 - t) * (1 - t);
      built.group.position.y = BURROW_DEPTH * (1 - ease);
      if (burrowMound) {
        const s = Math.max(0, 1 - t * 1.4);
        burrowMound.scale.setScalar(s);
        if (s <= 0) {
          container.remove(burrowMound);
          burrowMound = null;
        }
      }
      if (t >= 1) {
        burrowState = 'surfaced';
        built.group.position.y = 0;
      }
      return;
    }

    coreTime += dt;
    if (hasGlowingCore && flashMat) {
      // The king's nucleus: a slow idle heartbeat (so the eye is drawn to
      // the weak point) overlaid with a punchy hit flare — white-hot
      // emissive spike + a scale POP on the orb + a bloom flare on the
      // halo sprite, all decaying over CORE_HIT_DECAY. Unmistakable even
      // behind the 0.55-opacity body.
      hitPulse = Math.max(0, hitPulse - dt / CORE_HIT_DECAY);
      const beat = Math.sin(coreTime * 2.4);
      flashMat.emissiveIntensity = originalEmissiveIntensity * (1 + 0.18 * beat + 4.5 * hitPulse);
      tmpCoreEmissive.copy(coreBaseEmissive).lerp(CORE_WHITE, 0.85 * hitPulse);
      flashMat.emissive.copy(tmpCoreEmissive);
      if (coreMesh && coreMeshBaseScale) {
        coreMesh.scale.copy(coreMeshBaseScale).multiplyScalar(1 + 0.55 * hitPulse + 0.04 * beat);
      }
      if (coreGlow && coreGlowMat && coreGlowBaseScale) {
        coreGlowMat.opacity = 0.45 + 0.12 * beat + 0.95 * hitPulse;
        coreGlow.scale.copy(coreGlowBaseScale).multiplyScalar(1 + 0.5 * hitPulse + 0.06 * beat);
      }
    } else if (flashMat) {
      // Plain mobs — the existing brief colour flash on hit.
      if (flashTimer > 0) {
        flashTimer -= dt;
        const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
        flashMat.color.copy(originalColor).lerp(flashColor, t);
        if (originalEmissiveIntensity > 0) {
          flashMat.emissiveIntensity = originalEmissiveIntensity * (1 + 1.5 * t);
        }
      } else {
        flashMat.color.copy(originalColor);
        if (originalEmissiveIntensity > 0) {
          flashMat.emissiveIntensity = originalEmissiveIntensity;
        }
      }
    }

    // Capture home yaw the very first tick so idle scan rotates around the
    // actual placed-orientation (set by builder via faceWorld at spawn).
    if (!homeYawSet) {
      homeYaw = container.rotation.y;
      scanTargetYaw = homeYaw;
      homeYawSet = true;
    }

    // Vocalisation — hear it before you see it. (see tickVocalisation)
    tickVocalisation(dt);

    // ── Inside-aura tick (king-slime body, etc.) ─────────────────────
    // Cheap distance check + state machine for the "you're standing
    // INSIDE me" pressure. Grace period means a quick roll-through
    // costs no HP; lingering does.
    if (spec.aura) {
      const dx = playerPos.x - container.position.x;
      const dz = playerPos.z - container.position.z;
      const distSq = dx * dx + dz * dz;
      const r = spec.aura.radius;
      if (distSq <= r * r) {
        if (spec.aura.slowFactor !== undefined && spec.aura.slowFactor !== 1.0) {
          setPlayerInAura(spec.aura.slowFactor);
        }
        auraInsideTime += dt;
        if (auraInsideTime >= spec.aura.gracePeriod) {
          auraDamageTimer += dt;
          if (auraDamageTimer >= spec.aura.dotInterval) {
            auraDamageTimer -= spec.aura.dotInterval;
            damagePlayer(spec.aura.dotDamage, entityId, spec.damageType ?? 'magic');
          }
        }
      } else {
        auraInsideTime = 0;
        auraDamageTimer = 0;
      }
    }

    // ── Perception ─────────────────────────────────────────────────────
    // Refresh sight check every frame. Once aggroed, we stay aggroed
    // until loseSightTime seconds pass with no LOS AND we've transitioned
    // out of mid-attack states (winding/striking/recovering finish before
    // we drop aggro).
    const seesPlayer = canSeePlayer(playerPos, walkable);
    if (seesPlayer) {
      timeSinceLOS = 0;
      lastSeenPos.copy(playerPos);
      if (!aggroed) {
        aggroed = true;
        if (state === 'idle' || state === 'returning') {
          state = 'alerted';
          phaseTimer = 0;
          playEnemyWindup(audioSizeFor(spec), container.position);  // "I see you" growl
        }
      }
      // Shared aggro — broadcast the player's position so nearby
      // idle mobs join the fight. Overwriting each frame is fine;
      // it's the same player, the alert just keeps refreshing.
      raiseAlert(playerPos.x, playerPos.z);
    } else if (aggroed) {
      timeSinceLOS += dt;
      // Drop aggro only when we've lost sight long enough AND we're not
      // mid-attack. Mid-attack we let the swing finish first.
      const attackingStates: ReadonlyArray<EnemyState> = ['winding', 'striking', 'recovering'];
      if (timeSinceLOS >= loseSightTime && !attackingStates.includes(state)) {
        aggroed = false;
        if (state === 'chasing') {
          state = 'searching';
          phaseTimer = 0;
        }
      }
    }

    const distance = distToXZ(playerPos);

    // Chill / haste — movement pace + attack-phase timing scale by the
    // entity's speed buffs (chill = both < 1). moveSpeed is used by every
    // movement state; actionDt slows the windup/strike/recover advance.
    const speed = aggregateSpeed(entityId);
    const moveSpeed = spec.moveSpeed * speed.move;
    const actionDt = dt * speed.action;

    // Tick down per-ability cooldowns.
    if (cooldowns.size > 0) {
      for (const [id, t] of cooldowns) {
        if (t > 0) cooldowns.set(id, Math.max(0, t - dt));
      }
    }

    // Face target is conditional — idle/returning faces the scan target,
    // not the player.
    if (state !== 'idle' && state !== 'returning') {
      faceTarget(playerPos);
    }

    switch (state) {
      case 'idle': {
        // Shared aggro pickup — if a fellow mob has broadcast an alert
        // and we're inside its radius, join the fight. Sets lastSeenPos
        // to the alert location so 'searching' / 'chasing' have a
        // direction to head even if we don't currently have LOS.
        const alert = sampleAlert(container.position.x, container.position.z);
        if (alert) {
          aggroed = true;
          lastSeenPos.set(alert.x, 0, alert.z);
          state = 'alerted';
          phaseTimer = 0;
          playEnemyWindup(audioSizeFor(spec), container.position);
          break;
        }
        // Slow scan around home yaw. Pick a new target angle every
        // IDLE_SCAN_INTERVAL seconds; lerp toward it. Dim eye flare so
        // a watching player can tell at a glance "this one hasn't seen me yet."
        scanTimer += dt;
        if (scanTimer >= scanInterval) {
          scanTimer = 0;
          scanInterval = IDLE_SCAN_INTERVAL_MIN + gameRng() * IDLE_SCAN_INTERVAL_JITTER;
          if (gameRng() < IDLE_SCAN_HOLD_CHANCE) {
            // Pause: keep watching the current direction for a beat.
            scanTargetYaw = container.rotation.y;
          } else {
            // Gentle random-walk: step a little from where we're looking,
            // clamped to ±arc around home so it never slams side-to-side.
            const stepped = scanTargetYaw + (gameRng() * 2 - 1) * IDLE_SCAN_STEP;
            scanTargetYaw = Math.max(homeYaw - IDLE_SCAN_HALF_ARC,
                                     Math.min(homeYaw + IDLE_SCAN_HALF_ARC, stepped));
          }
        }
        // Lerp container yaw toward scan target. Wrap delta to nearest π.
        let delta = scanTargetYaw - container.rotation.y;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        container.rotation.y += delta * Math.min(1, dt * 0.9);
        applyIdleEyes();
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'alerted': {
        // Brief "I see you" pause. Eyes flare bright, body rears back
        // slightly, then commits to chase. Face player during this so the
        // moment reads — the model snaps from scan-pose to confront-pose.
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / ALERTED_DURATION);
        faceTarget(playerPos);
        setEyeFlare(t);
        applyTilt(-0.15 * t);   // slight rear-back (negative tilt)
        built.group.position.y = 0;
        if (phaseTimer >= ALERTED_DURATION) {
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }

      case 'searching': {
        // Walk toward last known position. If we get close to it without
        // re-acquiring (canSeePlayer handles that above by resetting
        // state to chasing on re-acquire), wait a beat, then return home.
        phaseTimer += dt;
        const dxs = lastSeenPos.x - container.position.x;
        const dzs = lastSeenPos.z - container.position.z;
        const distToLast = Math.hypot(dxs, dzs);
        // Face the search direction.
        faceTarget(lastSeenPos);
        if (distToLast > 0.4) {
          // Wary search — slower than chase (0.7x). Pathfinds around
          // obstacles, same as chasing.
          moveTowards(lastSeenPos.x, lastSeenPos.z, moveSpeed * 0.7, dt, walkable, nav);
        }
        // Search times out either by phaseTimer or by re-acquiring (above).
        if (phaseTimer >= SEARCH_DURATION) {
          state = 'returning';
          phaseTimer = 0;
        }
        // Dimmer eye flare during search — alert but not committed.
        if (eyeMat) eyeMat.emissiveIntensity = baseEyeEmissive * 0.85;
        if (haloMatL) haloMatL.color.copy(haloBaseColorL).multiplyScalar(0.8);
        if (haloMatR) haloMatR.color.copy(haloBaseColorR).multiplyScalar(0.8);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'returning': {
        // Returning home also picks up alerts — if combat reignites
        // before we've reached our post, turn back around.
        const returnAlert = sampleAlert(container.position.x, container.position.z);
        if (returnAlert) {
          aggroed = true;
          lastSeenPos.set(returnAlert.x, 0, returnAlert.z);
          state = 'chasing';
          phaseTimer = 0;
          break;
        }
        // Walk back to spawn post. On arrival, snap to home yaw and idle.
        const dxr = homePos.x - container.position.x;
        const dzr = homePos.z - container.position.z;
        const distHome = Math.hypot(dxr, dzr);
        if (distHome < 0.25) {
          state = 'idle';
          // Reset scan so it picks a fresh target next idle tick.
          scanTimer = scanInterval;
          scanTargetYaw = homeYaw;
          break;
        }
        // Walk back to spawn at 0.6x speed, routing around obstacles.
        moveTowards(homePos.x, homePos.z, moveSpeed * 0.6, dt, walkable, nav);
        // Face direction of travel — use the home delta direction so
        // facing is stable even if the path waypoint pulls slightly
        // sideways.
        tmpDir.set(homePos.x - container.position.x, 0, homePos.z - container.position.z);
        if (tmpDir.lengthSq() > 1e-6) tmpDir.normalize();
        tmpFlat.set(container.position.x + tmpDir.x, container.position.y, container.position.z + tmpDir.z);
        container.lookAt(tmpFlat);
        container.rotation.y += Math.PI;
        applyIdleEyes();
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'chasing': {
        // ATTACK FIRST: if a ready ability's band contains us, commit to
        // it — regardless of being a kiter or "too close." This is the
        // fix for kiters never attacking: the flee branch used to run
        // first, so an acolyte (which the faster player can always stay
        // close to) fled forever and never cast. Now it shoots whenever
        // it can; the cooldown between shots is its window to reposition.
        const ability = selectAbility(distance);
        if (ability) {
          currentAbility = ability;
          state = 'winding';
          phaseTimer = 0;
          rollWindupTime();
          playEnemyWindup(audioSizeFor(spec), container.position);
          // Snapshot the committed target (the 'lockedTarget' anchor) +
          // raise the spatial telegraph the instant the windup begins, so
          // the player has the full windup to step off the marker.
          setupAbilityTelegraph(ability, playerPos);
        } else {
          // No ability available (out of band, or on cooldown).
          const pref = spec.preferredRange ?? 0;
          if (pref > 0 && distance < pref) {
            // KITER too close — back away to reopen the gap (the
            // reposition window between shots). Aim ~2m directly away;
            // moveTowards pathfinds + clamps against walls. Cornered, it
            // can't retreat (your reward for running it down).
            const dx = container.position.x - playerPos.x;
            const dz = container.position.z - playerPos.z;
            const len = Math.hypot(dx, dz) || 1;
            moveTowards(
              container.position.x + (dx / len) * 2.0,
              container.position.z + (dz / len) * 2.0,
              moveSpeed, dt, walkable, nav,
            );
            tmpFlat.set(playerPos.x, container.position.y, playerPos.z);
            container.lookAt(tmpFlat);
            container.rotation.y += Math.PI;
          } else if (pref > 0 && distance <= commitDistance) {
            // KITER waiting out its cooldown while comfortably in range —
            // HOLD position (just keep facing the player). Without this it
            // would creep toward you between shots, which looked wrong for
            // a ranged enemy.
          } else if (distance > 0.1) {
            // Melee/charger, or a kiter that's genuinely out of range —
            // close the gap.
            moveTowards(playerPos.x, playerPos.z, moveSpeed, dt, walkable, nav);
          }
        }
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'winding': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += actionDt;
        const t = Math.min(1, phaseTimer / currentWindupTime);
        applyTelegraph(currentAbility.pose, 'windup', t);
        if (aoeTelegraph) aoeTelegraph.setProgress(t);
        // Melee creep — close at half-speed during windup so a stationary
        // player still gets clipped (a backpedalling player out-runs it).
        // Charges DON'T creep: the dash strike is the approach.
        const reach = firstMeleeReach(currentAbility);
        if (wantsCreep(currentAbility) && reach !== null && distance > reach) {
          moveTowards(playerPos.x, playerPos.z, moveSpeed * 0.45, dt, walkable, nav);
        }
        if (phaseTimer >= currentWindupTime) {
          state = 'striking';
          phaseTimer = 0;
          // Arm the timeline: clear per-step latches + events, capture the
          // leap takeoff point.
          stepStarted = currentAbility.steps.map(() => false);
          stepDone = currentAbility.steps.map(() => false);
          stepEvents.clear();
          leapStart.copy(container.position);
        }
        break;
      }

      case 'striking': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += actionDt;
        // Run the timeline: fire each step once its trigger is met, then
        // keep ticking it until its action latches done. Per-step state,
        // so steps never interfere with each other.
        const steps = currentAbility.steps;
        for (let i = 0; i < steps.length; i++) {
          if (stepDone[i]) continue;
          if (!stepStarted[i]) {
            if (!triggerMet(steps[i].trigger, phaseTimer)) continue;
            stepStarted[i] = true;
          }
          const done = runAction(steps[i].action, currentAbility, steps[i].id, playerPos, distance, dt, walkable, nav);
          if (done) stepDone[i] = true;
        }
        applyTelegraph(currentAbility.pose, 'strike', 1);
        if (phaseTimer >= currentAbility.strike) {
          state = 'recovering';
          phaseTimer = 0;
          // Safety: snap any in-air leap Y back to ground if the touchdown
          // didn't catch the final frame (dt overshoot), so the enemy
          // can't end up floating at the arc peak.
          container.position.y = 0;
        }
        break;
      }

      case 'recovering': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += actionDt;
        const t = Math.min(1, phaseTimer / currentAbility.recover);
        applyTelegraph(currentAbility.pose, 'recover', t);
        if (phaseTimer >= currentAbility.recover) {
          cooldowns.set(currentAbility.id, currentAbility.cooldown ?? 0);
          currentAbility = null;
          clearAoeTelegraph();   // safety — normally disposed at strike
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }
    }

    // ── Post-AI animation/audio overlays ─────────────────────────────
    // Order matters: head crane + knockback, then gait (reads this frame's
    // net movement), then the presence overlay last so its idle bob stacks
    // on top of whatever the state animation set.
    tickHeadCrane(dt, distance);
    tickKnockback(dt, walkable);
    tickLocomotion(dt);
    tickPresenceOverlay(dt);
  }

  function setDebugState(s: EnemyState, t: number) {
    state = s;
    phaseTimer = t;
    // Clear the timeline latches (debug poses don't run a real cast).
    stepStarted = [];
    stepDone = [];
    stepEvents.clear();
    switch (s) {
      case 'chasing':
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeFlare(f);
        applyTilt(0.5 * f);
        built.group.position.y = 0.10 * f;
        break;
      }
      case 'striking':
        setEyeFlare(1);
        applyTilt(-0.25);
        built.group.position.y = 0;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeFlare(1 - f);
        applyTilt(THREE.MathUtils.lerp(-0.25, 0, f));
        built.group.position.y = 0;
        break;
      }
    }
  }

  function setDebugPosition(x: number, z: number) {
    container.position.x = x;
    container.position.z = z;
  }

  function faceWorld(x: number, z: number) {
    tmpFlat.set(x, container.position.y, z);
    container.lookAt(tmpFlat);
    container.rotation.y += Math.PI;
  }

  return {
    entityId,
    kind: spec.id,
    isBoss: !!spec.isBoss,
    bossName: spec.bossName ?? spec.name,
    group: container,
    position: container.position,
    // Where the swing aims + the damage number floats. 0.6×scale assumes a
    // body centred there; a low-rigged giant (the king) overrides it.
    aimHeight: spec.aimHeight ?? 0.6 * (spec.scale ?? 1),
    hitFeedback: 'heavy',
    hitTargets: built.hitTargets,
    collisionRadius: spec.collisionRadius,
    hitRadius: spec.hitRadius ?? 0,
    noPlayerCollision: !!spec.noPlayerCollision,
    phasing: !!spec.phasing,
    maxHp: spec.hp,
    get alive() {
      return aliveLocal;
    },
    get dying() {
      return deathTimer >= 0;
    },
    get hp() {
      const e = getEntity(entityId);
      return e?.hp?.current ?? 0;
    },
    get aiState() {
      return state;
    },
    takeDamage,
    update,
    setDebugState,
    setDebugPosition,
    faceWorld,
    applyKnockback,
  };
}
