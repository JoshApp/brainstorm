import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { emit } from '../broadcast/event-bus';
import type { EnemySpec } from '../content/enemies';
import { resolveAbilities, meleeReachOf, aoeEffectOf, type Ability } from '../content/abilities';
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
import { computeDamage, setEntityCombatStats, clearEntityCombatStats, type DamageEvent } from '../combat/damage';
import { playEnemyDeath, playEnemyWindup, type EnemyDeathSize } from '../audio/sfx';
import { spawnProjectile } from '../combat/projectile-pool';
import { spawnXpWisps } from '../effects/xp-wisps';
import { spawnGoldCoins } from '../effects/gold-coins';
import { raiseAlert, sampleAlert } from './alerts';
import type { Damageable } from '../combat/damageable';
import { gameRng, gameRngInt, gameRngChance } from '../engine/rng';

// Map an EnemySpec → audio size bucket. Used by death + windup sounds so
// big mobs sound big and the wraith reads as spectral, not physical.
function audioSizeFor(spec: EnemySpec): EnemyDeathSize {
  if (spec.id === 'wraith') return 'spectral';
  if (spec.id === 'rat') return 'small';
  return 'medium';
}

/** Release an enemy's ECS entity + registered combat stats. Called from level
 *  teardown for mobs the player LEFT ALIVE — those never hit the death path
 *  that frees them, so without this their entity + baseline stats leak into
 *  the world map across descents. Idempotent (killed mobs already freed). */
export function disposeEnemy(e: Enemy): void {
  clearEntityCombatStats(e.entityId);
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

// How long an enemy hesitates after first spotting the player before
// committing to chase. Sells the "I see you" moment — also gives the
// player a reaction window.
const ALERTED_DURATION = 0.45;

// How long the enemy will search at the last-known position before giving
// up. Doesn't override per-spec loseSightTime; this is the search PHASE
// duration after sight is already lost.
const SEARCH_DURATION = 3.0;

// Idle scan: rotates yaw target every N seconds within a small arc around
// the home direction. Makes idle enemies feel watchful rather than statues.
const IDLE_SCAN_INTERVAL = 2.5;
const IDLE_SCAN_HALF_ARC = 0.7;   // ±40° around home yaw

export interface Enemy extends Damageable {
  entityId: EntityId;
  /** Spec id from src/content/enemies.ts ('rat', 'skirmisher', etc.). */
  kind: string;
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
  container.add(built.group);

  scene.add(container);

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

  // Per-instance presentation state.
  let flashTimer = 0;
  const originalColor = flashMat ? flashMat.color.clone() : new THREE.Color();
  const flashColor = new THREE.Color(CONFIG.ENEMY_HIT_FLASH_COLOR);
  const baseEyeEmissive = spec.baseEyeEmissive;

  let state: EnemyState = 'idle';
  let phaseTimer = 0;
  let strikeAlreadyHit = false;
  let aliveLocal = true;

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
  const aoeTarget = new THREE.Vector3();
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
  // Idle scan yaw target — rotates in place to feel watchful.
  let scanTimer = IDLE_SCAN_INTERVAL;  // pick a new target immediately
  let scanTargetYaw = 0;
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
    const entity = getEntity(entityId);
    if (!entity || !entity.hp) return 0;
    const result = computeDamage(event);
    entity.hp.current = Math.max(0, entity.hp.current - result.applied);
    flashTimer = CONFIG.ENEMY_HIT_FLASH_DURATION;
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
      destroyEntity(entityId);
      playEnemyDeath(audioSizeFor(spec));
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
  function applyTelegraph(style: Ability['telegraph'], phase: 'windup' | 'strike' | 'recover', t: number) {
    const pose = TELEGRAPH_POSES[(style ?? 'swing') as TelegraphStyle];
    applyTilt(poseValue(pose.rigTilt, phase, t));
    built.group.position.y = poseValue(pose.bob, phase, t);
    const arm = poseValue(pose.armSwing, phase, t);
    if (shoulderL) shoulderL.rotation.x = shoulderBaseLX + arm;
    if (shoulderR) shoulderR.rotation.x = shoulderBaseRX + arm;
    setEyeFlare(phase === 'windup' ? t : phase === 'strike' ? 1 : 1 - t);
  }

  /** Run one ability effect during the strike phase. Instantaneous
   *  effects (melee/projectile) latch on strikeAlreadyHit so they fire
   *  once; dash moves the enemy every frame and lands one contact hit. */
  function runEffect(
    eff: import('../content/abilities').AbilityEffect,
    ability: Ability,
    playerPos: THREE.Vector3,
    distance: number,
    dt: number,
    walkable: WalkableRegion,
    nav?: NavGrid,
  ) {
    switch (eff.kind) {
      case 'melee': {
        if (!strikeAlreadyHit && distance <= eff.reach) {
          damagePlayer(ability.damage, entityId, eff.damageType ?? 'physical');
          strikeAlreadyHit = true;
        }
        break;
      }
      case 'projectile': {
        if (!strikeAlreadyHit) {
          tmpMuzzle.set(eff.muzzle[0], eff.muzzle[1], eff.muzzle[2]);
          container.updateMatrixWorld();
          tmpMuzzle.applyMatrix4(container.matrixWorld);
          tmpTarget.set(playerPos.x, tmpMuzzle.y, playerPos.z);
          spawnProjectile({
            typeId: eff.projectileId,
            origin: tmpMuzzle,
            target: tmpTarget,
            damage: ability.damage,
            source: entityId,
          });
          strikeAlreadyHit = true;
        }
        break;
      }
      case 'dash': {
        // Drive the enemy for the whole strike phase. 'player' = lunge
        // at them (charge); 'away' = launch back (a future retreat-leap).
        if (eff.toward === 'player') {
          moveTowards(playerPos.x, playerPos.z, eff.speed, dt, walkable, nav);
        } else {
          const dx = container.position.x - playerPos.x;
          const dz = container.position.z - playerPos.z;
          const len = Math.hypot(dx, dz) || 1;
          moveTowards(
            container.position.x + (dx / len) * 2.0,
            container.position.z + (dz / len) * 2.0,
            eff.speed, dt, walkable, nav,
          );
        }
        if (!strikeAlreadyHit && distance <= eff.contactReach) {
          damagePlayer(ability.damage, entityId, eff.damageType ?? 'physical');
          strikeAlreadyHit = true;
        }
        break;
      }
      case 'aoe': {
        if (!strikeAlreadyHit) {
          // Resolve against the LOCKED target (set at windup start),
          // not the enemy's current position — the player dodges by
          // leaving the marked circle, regardless of where the enemy is.
          const dx = playerPos.x - aoeTarget.x;
          const dz = playerPos.z - aoeTarget.z;
          if (dx * dx + dz * dz <= eff.radius * eff.radius) {
            damagePlayer(ability.damage, entityId, eff.damageType ?? 'physical');
          }
          clearAoeTelegraph();
          strikeAlreadyHit = true;
        }
        break;
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

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid) {
    if (!aliveLocal) {
      // Dying branch — run the death animation; everything else (AI,
      // perception, movement) is gated off.
      if (deathTimer >= 0) tickDying(dt);
      return;
    }

    if (flashMat) {
      if (flashTimer > 0) {
        flashTimer -= dt;
        const t = Math.max(0, flashTimer / CONFIG.ENEMY_HIT_FLASH_DURATION);
        flashMat.color.copy(originalColor).lerp(flashColor, t);
      } else {
        flashMat.color.copy(originalColor);
      }
    }

    // Capture home yaw the very first tick so idle scan rotates around the
    // actual placed-orientation (set by builder via faceWorld at spawn).
    if (!homeYawSet) {
      homeYaw = container.rotation.y;
      scanTargetYaw = homeYaw;
      homeYawSet = true;
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
          playEnemyWindup(audioSizeFor(spec));  // "I see you" growl
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
          playEnemyWindup(audioSizeFor(spec));
          break;
        }
        // Slow scan around home yaw. Pick a new target angle every
        // IDLE_SCAN_INTERVAL seconds; lerp toward it. Dim eye flare so
        // a watching player can tell at a glance "this one hasn't seen me yet."
        scanTimer += dt;
        if (scanTimer >= IDLE_SCAN_INTERVAL) {
          scanTimer = 0;
          scanTargetYaw = homeYaw + (gameRng() * 2 - 1) * IDLE_SCAN_HALF_ARC;
        }
        // Lerp container yaw toward scan target. Wrap delta to nearest π.
        let delta = scanTargetYaw - container.rotation.y;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        container.rotation.y += delta * Math.min(1, dt * 1.2);
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
          moveTowards(lastSeenPos.x, lastSeenPos.z, spec.moveSpeed * 0.7, dt, walkable, nav);
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
          scanTimer = IDLE_SCAN_INTERVAL;
          scanTargetYaw = homeYaw;
          break;
        }
        // Walk back to spawn at 0.6x speed, routing around obstacles.
        moveTowards(homePos.x, homePos.z, spec.moveSpeed * 0.6, dt, walkable, nav);
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
        const pref = spec.preferredRange ?? 0;
        if (pref > 0 && distance < pref) {
          // KITER — the player is inside our preferred standoff band, so
          // back away to re-open the gap before attacking again. Aim a
          // point ~2m directly away from the player; moveTowards pathfinds
          // + clamps it against walls. Cornered against a wall it can't
          // retreat (player's reward for running it down); pinned mid-
          // windup it can't retreat either (rushing the cast beats it).
          const dx = container.position.x - playerPos.x;
          const dz = container.position.z - playerPos.z;
          const len = Math.hypot(dx, dz) || 1;
          moveTowards(
            container.position.x + (dx / len) * 2.0,
            container.position.z + (dz / len) * 2.0,
            spec.moveSpeed, dt, walkable, nav,
          );
          tmpFlat.set(playerPos.x, container.position.y, playerPos.z);
          container.lookAt(tmpFlat);
          container.rotation.y += Math.PI;
        } else {
          // Ability selection — pick the highest-priority ready ability
          // whose range band we're in. If one fires, run its windup;
          // otherwise close the gap toward commit distance.
          const ability = selectAbility(distance);
          if (ability) {
            currentAbility = ability;
            state = 'winding';
            phaseTimer = 0;
            strikeAlreadyHit = false;
            rollWindupTime();
            playEnemyWindup(audioSizeFor(spec));
            // AoE abilities lock their target + raise the ground
            // telegraph the instant the windup begins, so the player
            // has the full windup to step off the marker.
            const aoe = aoeEffectOf(ability);
            if (aoe) {
              if (aoe.targetMode === 'self') aoeTarget.set(container.position.x, 0, container.position.z);
              else aoeTarget.set(playerPos.x, 0, playerPos.z);
              clearAoeTelegraph();
              aoeTelegraph = spawnAoeTelegraph(scene, aoeTarget.x, aoeTarget.z, aoe.radius);
            }
          } else if (distance > 0.1) {
            // No ability in band — close (or, if inside every band's
            // minRange, still close to reach the melee fallback).
            moveTowards(playerPos.x, playerPos.z, spec.moveSpeed, dt, walkable, nav);
          }
        }
        setEyeFlare(0);
        applyTilt(0);
        built.group.position.y = 0;
        break;
      }

      case 'winding': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / currentWindupTime);
        applyTelegraph(currentAbility.telegraph, 'windup', t);
        if (aoeTelegraph) aoeTelegraph.setProgress(t);
        // Melee creep — close at half-speed during windup so a stationary
        // player still gets clipped (a backpedalling player out-runs it).
        // Charges DON'T creep: the dash strike is the approach.
        const wantsCreep = currentAbility.creep
          ?? (meleeReachOf(currentAbility) !== null);
        const reach = meleeReachOf(currentAbility);
        if (wantsCreep && reach !== null && distance > reach) {
          moveTowards(playerPos.x, playerPos.z, spec.moveSpeed * 0.45, dt, walkable, nav);
        }
        if (phaseTimer >= currentWindupTime) {
          state = 'striking';
          phaseTimer = 0;
        }
        break;
      }

      case 'striking': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += dt;
        for (const eff of currentAbility.effects) {
          runEffect(eff, currentAbility, playerPos, distance, dt, walkable, nav);
        }
        applyTelegraph(currentAbility.telegraph, 'strike', 1);
        if (phaseTimer >= currentAbility.strike) {
          state = 'recovering';
          phaseTimer = 0;
        }
        break;
      }

      case 'recovering': {
        if (!currentAbility) { state = 'chasing'; break; }
        phaseTimer += dt;
        const t = Math.min(1, phaseTimer / currentAbility.recover);
        applyTelegraph(currentAbility.telegraph, 'recover', t);
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

    // ── Presence overlay ─────────────────────────────────────────────
    // Applied AFTER the state animation so it stacks on what the state
    // set (e.g. winding's 0.10*t lift gets a bob on top — looks like
    // the wraith levitates higher as it rears up).
    //
    // Conventions:
    //   - position.y is WRITTEN by state code each frame, so presence
    //     adds (+=) to it. Same for container.rotation.y (state's lookAt
    //     writes it).
    //   - position.x/z and rotation.x/z on built.group are NOT touched
    //     by state code, so presence writes them directly (no drift).
    if (presence) {
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
  }

  function setDebugState(s: EnemyState, t: number) {
    state = s;
    phaseTimer = t;
    strikeAlreadyHit = false;
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
    group: container,
    position: container.position,
    aimHeight: 0.6,
    hitFeedback: 'heavy',
    hitTargets: built.hitTargets,
    collisionRadius: spec.collisionRadius,
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
  };
}
