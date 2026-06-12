import * as THREE from 'three';
import { CONFIG } from '../config';
import { damagePlayer } from '../player/health';
import { applyPlayerKnockback } from '../player/knockback';
import { setPlayerInAura } from '../player/inside-aura';
import { kickShake } from '../combat/screen-shake';
import { spawnHazardField } from '../combat/hazard-field';
import { isBossEngaged } from '../ui/boss-engagement';
import { emit } from '../broadcast/event-bus';
import { stampSplat, emitGoreSplash } from '../scene/splat-map';
import type { EnemySpec } from '../content/enemies';
import { ENEMY_AUDIO_SIZE, ENEMY_VOCAL_ARCHETYPE } from '../content/enemies';
import {
  resolveAbilities, firstMeleeReach, wantsCreep, ELEMENTS,
  type Ability, type AbilityAction, type Anchor, type Trigger, type Element,
} from '../content/abilities';
import { applyBuff } from '../ecs/buffs';
import { spawnAoeTelegraph, type AoeTelegraph } from '../effects/aoe-telegraph';
import { spawnLashTendril, type LashTendril } from '../effects/lash-tendril';
import { isBossEncounterEngaged } from './boss-encounter';
import { levelHasFogWall } from '../ui/boss-engagement';
import { applyTelegraphPose, type TelegraphNodes, type TelegraphStyle } from './pose-clips';
import type { WalkableRegion } from '../level/walkable';
import type { NavGrid, Waypoint } from '../level/nav-grid';
import {
  spawn as spawnEntity,
  destroy as destroyEntity,
  get as getEntity,
  generateEntityId,
} from '../ecs/world';
import type { EntityId } from '../ecs/types';
import { createEyePresenter, createCoreReactor } from './enemy-presentation';
import {
  acquireCreatureInstancing, releaseCreatureInstancing,
} from './creature-instancing';
import { isPooledGeometry } from '../scene/geometry-pool';
import { createBodyAnimator } from './enemy-animation';
import { Animator } from '../anim/animator';
import { type BuiltModel } from '../ecs/build-model';
import { buildCreature } from '../content/build-creature';
import type { Creature } from '../content/creature-types';
import { ITEMS } from '../content/items';
import { createPickup } from '../interactables/pickup';
import { computeDamage, setEntityCombatStats, clearEntityCombatStats, registerDamageSink, unregisterDamageSink, type DamageEvent } from '../combat/damage';
import { aggregateSpeed } from '../combat/modifiers';
import { playEnemyDeath, playEnemyWindup, playEnemyVocal, playEnemyHurt, playEnemyStrike, playEnemyFootstep, type EnemyDeathSize, type VocalArchetype } from '../audio/sfx';
import { spawnProjectile } from '../combat/projectile-pool';
import { spawnXpWisps } from '../effects/xp-wisps';
import { createBlobShadow } from '../effects/blob-shadow';
import { spawnGoldCoins } from '../effects/gold-coins';
import { raiseAlert, sampleAlert } from './alerts';
import { joinPack, leavePack, packMoveTarget, packScratch, requestToken } from './pack';
import type { Damageable } from '../combat/damageable';
import { setZoneEnabled, type Hurtbox } from '../combat/hurtbox';
import { createStunStars, type StunStars } from './stun-stars';
import { ARCHETYPE_CLIPS } from '../anim/clips-biped';
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
  leavePack(e.entityId);
  // Free any shared-InstancedMesh slots (no corpse — the level subtree is
  // being torn down wholesale). Idempotent; killed mobs already released.
  releaseCreatureInstancing(e.entityId);
}

// Enemy = a mob driven by its EnemySpec.
//
// Geometry/materials/hurtbox come from spec.creature via buildCreature(). This
// module owns only the behavior glue:
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
  | 'dormant'     // boss-style spawn: no AI, no perception, waits for an
                  // external wake signal (e.g. boss-bar engagement).
                  // Used so a procgen-placed boss doesn't aggro the
                  // moment the player enters the LEVEL — only when the
                  // player enters the ARENA (crosses the fog wall).
  | 'alerted'     // first sight — brief rear-up before committing
  | 'chasing'
  | 'winding'
  | 'striking'
  | 'recovering'
  | 'searching'   // lost sight, heading to last known position
  | 'returning'   // gave up search, walking back to post
  | 'staggered';  // poise broken by a heavy hit — reeling, can't act,
                  // a free-hit window (see the poise system + Might)

// AI timing/feel constants are tuned in src/config.ts (CONFIG.ENEMY_AI);
// the rationale for each stays here at the use site.

// How long an enemy hesitates after first spotting the player before
// committing to chase. Sells the "I see you" moment — also gives the
// player a reaction window.
const ALERTED_DURATION = CONFIG.ENEMY_AI.ALERTED_DURATION;

// Grace beat a fog-gate boss grants the player on waking — it closes the
// distance but holds fire this long so you can orient out of the walk-in.
const ENGAGE_GRACE = 2.4;
// Within this distance an IDLE/unaware mob vocalises much more often (a
// "stir") so a lurking thing reliably announces itself as you near it —
// hear-before-see — while staying sparse across the rest of the dark.
const VOCAL_STIR_RANGE = 7;

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
const NAV_STUCK_TIME = CONFIG.ENEMY_AI.NAV_STUCK_TIME;

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
  /** Inert behind its fog gate until the player commits — can't perceive,
   *  can't be tap-attacked (the tap should reach the gate, not the boss). */
  dormant: boolean;
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
  /** Locational hurtbox zones (body / head / weak / armor). The combat debug
   *  overlay draws these; the swing resolver tests against the ENABLED ones.
   *  See src/combat/hurtbox.ts + docs/COMBAT-HIT-SYSTEM.md. */
  hurtbox: Hurtbox;
  /** Activate/deactivate a hurtbox zone by id at runtime (open a weak point,
   *  break an armor plate). Returns true if a zone matched. */
  setZoneEnabled(id: string, on: boolean): boolean;
  /** Mobs take the full crunch + fire the player's on-hit passives. */
  hitFeedback: 'heavy';
  /** Species gore — colour + multiplier from the spec (combat stamps
   *  the splat map in the target's own blood). */
  bloodColor: number;
  bloodAmount: number;
  /** Finisher window — true only when STAGGERED (poise broken). A heavy hit
   *  here executes. */
  executable: boolean;
  /** If true, the player walks through this mob (movement-only).
   *  See EnemySpec.noPlayerCollision. */
  noPlayerCollision: boolean;
  takeDamage(event: DamageEvent): number;
  /** Chip the poise pool; breaking it staggers the enemy (cancels its
   *  action, opens a free-hit window). Called by the combat cone on a
   *  heavy melee hit. */
  applyStaggerDamage(amount: number): boolean;
  update(
    dt: number,
    playerPos: THREE.Vector3,
    walkable: WalkableRegion,
    nav?: NavGrid,
  ): void;
  setDebugState(state: EnemyState, phaseTimer: number): void;
  setDebugPosition(x: number, z: number): void;
  /** Observation tooling: jump a multi-phase boss to phase `index`
   *  (0-based), applying each transition's settled pose INSTANTLY (no
   *  collapse animation) — for clean per-phase snaps. No-op for
   *  single-phase enemies or an index ≤ current. */
  setDebugBossPhase(index: number): void;
  /** Observation tooling: trigger the NEXT phase transition WITH its
   *  collapse animation (as if the current phase was just killed) — for
   *  watching the transition live. No-op if already on the last phase. */
  debugAdvanceBossPhase(): void;
  /** Current 0-based phase index + count (1/1 for single-phase). */
  bossPhaseInfo(): { index: number; count: number };
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
const tmpFanTarget = new THREE.Vector3();
const tmpEssenceOrigin = new THREE.Vector3();

/** Optional callback fired right after an enemy reaches 0 HP — used by
 *  the builder to spawn split-on-death offspring. Runs AFTER drops +
 *  the kill event, so any spawned children appear in the same frame's
 *  enemy list and the kill is already recorded. `entityId` identifies the
 *  dying enemy exactly so the builder can attribute split children to the
 *  parent's room without a fragile position lookup (two enemies dying at
 *  the same spot used to mis-attribute). */
export type EnemyOnDeath = (
  spec: EnemySpec,
  deathPosition: THREE.Vector3,
  entityId: EntityId,
) => void;

export function createEnemy(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  spec: EnemySpec,
  onDeath?: EnemyOnDeath,
  /** Optional spawn-time flags. `dormant: true` skips perception
   *  + AI + idle animation until the boss-engagement flag flips. */
  options?: { dormant?: boolean },
): Enemy {
  // Container: world position + yaw to face player.
  const container = new THREE.Group();
  container.position.copy(position);
  // Last seen player position — the death spray throws away from it.
  const lastPlayerXZ = new THREE.Vector3();

  // Skeleton-first creature: dimensions + hurtbox are MEASURED/derived by
  // buildCreature (docs/CREATURE-SYSTEM.md). The rest of this module consumes
  // `built` (group/parts/slots/materials/hitTargets) the same way regardless of
  // archetype, so presentation + animation are archetype-agnostic.
  const creature = buildCreature(spec.creature);        // builds + merges + measures internally
  const creatureRef: Creature = creature;               // for setJointVisible (part-breaks)
  // Creature → BuiltModel shape (joints ARE the slots) so the rest of the
  // module (presentation/animation) consumes it unchanged.
  const built: BuiltModel = {
    group: creature.group, parts: creature.parts, slots: creature.joints,
    materials: creature.materials, hitTargets: creature.hitTargets,
  };
  // Bosses loom larger via spec.scale. localToWorld carries the group scale
  // into the zone endpoints automatically, but a zone's radius is a raw scalar
  // — scale it by hand so the hitboxes grow with the body. aimHeight tracks
  // scale too (unless explicitly pinned).
  const sc = spec.scale ?? 1;
  if (sc !== 1) {
    creature.group.scale.multiplyScalar(sc);
    for (const z of creature.hurtbox.zones) z.shape.radius *= sc;
  }
  const aimHeightResolved = spec.aimHeight ?? creature.bounds.aimHeight * sc;   // MEASURED body centre × scale
  const hurtbox: Hurtbox = creature.hurtbox;            // auto per-bone + authored zones
  const essenceRigYDefault = aimHeightResolved;
  // The floor seat is BAKED into the geometry by buildCreature (it shifts the
  // model up by its below-floor dip), so the runtime y stays a clean 0 — no
  // offset to fight the per-frame y reset or the leap arcs that drive y.
  container.add(creature.group);

  // Creatures don't cast real (cube-map) shadows — they use a blob instead.
  // A moving caster re-renders into the lamp's 6-face shadow cube every frame
  // (~5-6 draws + fill per creature, ~half the frame in a fight); its cast
  // falls away from the lamp and barely reads anyway. Static world keeps its
  // real lamp shadows; the creature gets a cheap floor blob for grounding.
  creature.group.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  const blob = createBlobShadow(creature.bounds.radius * sc * 1.1);
  blob.visible = !spec.burrowed;   // hidden while buried; revealed on emerge
  container.add(blob);
  // World entity id — generated here (rather than at the ECS spawn below)
  // so the instancing registry can key on it. Same id, same lifecycle.
  const entityId = generateEntityId(`enemy-${spec.id}`);
  // Instanced rendering — same-type mobs share one InstancedMesh per joint
  // segment (src/mobs/creature-instancing.ts). The model is fully composed
  // at this point (merged, scaled, shadow-flagged); acquire hides the
  // per-enemy segment meshes and assigns instance slots. null = legacy
  // per-enemy rendering (bosses, or the CONFIG.CREATURE_INSTANCING switch
  // off) — every path below works identically either way.
  const instancing = acquireCreatureInstancing(scene, entityId, spec, built, container);
  // Base model scale, captured for the lash deform (which elongates the
  // body toward the player on a 'lash' telegraph, then eases back here).
  const groupBaseScale = built.group.scale.clone();
  /** Toggle stagger-window weak points (zones flagged openWhenStaggered). */
  function setStaggerVuln(on: boolean): void {
    for (const z of hurtbox.zones) if (z.openWhenStaggered) z.enabled = on;
  }
  // "Seeing stars" stun ring — lazily built the first time this mob is staggered
  // (most never are), parented to the container above the head.
  let stunStars: StunStars | null = null;

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
  // Telegraph rig — the nodes the windup/strike/recover pose drives. Built
  // once, shared with the asset bench via applyTelegraphPose so the live mob
  // and the bench animate through one code path.
  const telegraphNodes: TelegraphNodes = {
    tiltPart, root: built.group, shoulderL, shoulderR, shoulderBaseLX, shoulderBaseRX,
  };
  // Body-animation controller — gait, head-crane, knockback, and the presence
  // idle overlay. Owns its own body refs (hips, neck, chant orb) + mutable
  // state (see enemy-animation.ts); the factory no longer carries them.
  const bodyAnim = createBodyAnimator(container, built, spec);
  // Keyframe animator — drives joint slots via clips. Source: an explicit
  // spec.animation bundle (marrow boss) OR, for a creature, its ARCHETYPE clip
  // library (docs/CREATURE-SYSTEM.md) — so every biped gets attack animation for
  // free. Runs AFTER bodyAnim so its writes win on the joints it owns.
  const animBundle = spec.animation ?? (spec.creature ? ARCHETYPE_CLIPS[spec.creature.archetype] : undefined);
  // When a creature drives attacks via clips, the legacy telegraph POSE is gated
  // off (below) so the clip is the sole driver of the swing.
  const usesClipAttacks = !!spec.creature && !!animBundle;
  const clipAnimator = animBundle
    ? new Animator(built.slots, animBundle.joints)
    : null;
  let prevAnimState: EnemyState | null = null;
  let prevAnimAbilityId: string | null = null;
  let prevAnimPhaseIndex = -1;
  // Visual presentation controllers — the eye-flare windup telegraph and the
  // hit/core-glow flash. Both own their material refs internally (see
  // enemy-presentation.ts). Thin local aliases keep the AI state machine's
  // setEyeFlare/applyIdleEyes call sites below unchanged.
  const eyePresenter = createEyePresenter(built, spec);
  const coreReactor = createCoreReactor(built, spec, instancing);
  const setEyeFlare = eyePresenter.setFlare;
  const applyIdleEyes = eyePresenter.applyIdle;

  // World entity (HP + buffs). For multi-phase bosses, HP starts at
  // phase[0].hp; phase transitions refill to the next phase's HP.
  // (entityId was generated above, before the instancing acquire.)
  let phaseIndex = 0;
  const phases = spec.phases ?? null;
  const initialHp = phases ? phases[0].hp : spec.hp;
  const initialAbilities = phases ? phases[0].abilities : (spec.abilities ?? []);
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: initialHp, current: initialHp },
    buffs: [],
    passives: [],
  });
  // Per-phase mutable state (so we can reassign on transition).
  let currentMaxHp = initialHp;
  let currentAbilities = initialAbilities;
  // Per-phase partBreaks: tracks which thresholds have fired so we
  // don't re-hide parts every tick. Reset on phase entry.
  let firedPartBreaks = new Set<number>();
  let phaseInvulnTimer = 0;
  // Phase-transition COLLAPSE animation (the skeleton's downed fall). While
  // active the boss is inert (no AI) AND invulnerable, and the rig EASES to
  // the new phase's crawl pose instead of snapping there — so the transition
  // reads as a fall, not a teleport. Set up on transition, advanced in tick.
  let phaseFallActive = false;
  let phaseFallElapsed = 0;
  let phaseFallDuration = 0;
  let phaseFallNode: THREE.Object3D | null = null;
  let phaseFallFromY = 0, phaseFallToY = 0;
  let phaseFallFromPitch = 0, phaseFallToPitch = 0;

  // Helper used by phase transitions + intra-phase part-break thresholds
  // to hide named model parts. A single logical part (a whole leg) is
  // authored as MANY primitives sharing one `name`, but built.parts is a
  // Map (one entry per name) — so we traverse the live tree and hide EVERY
  // object with a matching name, not just the one the map kept. Without
  // this, "hide the legs" only dropped a single foot bone. Unknown names
  // are silent no-ops.
  function hidePartsByName(names: readonly string[]): void {
    const want = new Set(names);
    // Creature path: names are JOINTs — hide the joint subtree + its zones
    // (the clean part-break). Legacy path: traverse + hide meshes by name.
    if (creatureRef) {
      for (const n of names) creatureRef.setJointVisible(n, false);
    }
    built.group.traverse((o) => {
      if (o.name && want.has(o.name)) o.visible = false;
    });
  }

  // Advance the boss to its NEXT phase. Shared by the kill-triggered
  // transition (combat) and the debug phase-jump (observation tooling).
  // `animate`: true plays the collapse over the invuln window (the real
  // fight); false snaps straight to the settled pose (clean phase snaps).
  function enterNextPhase(animate: boolean): void {
    if (!phases || phaseIndex + 1 >= phases.length) return;
    const next = phases[phaseIndex + 1];
    phaseIndex++;
    currentMaxHp = next.hp;
    currentAbilities = next.abilities;
    abilities = resolveAbilities(spec, currentAbilities);
    const ent = getEntity(entityId);
    if (ent?.hp) { ent.hp.base = next.hp; ent.hp.current = next.hp; }
    firedPartBreaks = new Set();
    phaseInvulnTimer = animate ? (next.invulnEntryTime ?? 0) : 0;
    if (next.hideParts) hidePartsByName(next.hideParts);
    if (next.rigYOffset !== undefined || next.rigPitch !== undefined) {
      // Lower / tilt the RIG node (not built.group): the per-frame pose bob
      // OWNS built.group.position.y and would clobber an offset there. The
      // rig's position.y is bob-safe; pitch goes on built.group (also safe).
      const node = tiltPart ?? built.group;
      if (animate) {
        phaseFallNode = node;
        phaseFallFromY = node.position.y;
        phaseFallToY = node.position.y + (next.rigYOffset ?? 0);
        phaseFallFromPitch = built.group.rotation.x;
        phaseFallToPitch = next.rigPitch ?? built.group.rotation.x;
        phaseFallElapsed = 0;
        // Fall across the invuln window so he's untouchable + inert as he
        // drops, then rises as the crawler. Floor at 0.4s for readability.
        phaseFallDuration = Math.max(0.4, next.invulnEntryTime ?? 0.8);
        phaseFallActive = true;
      } else {
        // Instant settle — snap the model to the new phase's crawl pose.
        node.position.y += next.rigYOffset ?? 0;
        if (next.rigPitch !== undefined) built.group.rotation.x = next.rigPitch;
        phaseFallActive = false;
      }
    }
    clearAoeTelegraph();
    clearLashTendril();
    state = 'chasing';
    phaseTimer = 0;
  }
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

  // Lash deform — eased 0..1 body elongation toward the player during a
  // 'lash' telegraph (the slime rears + reaches, then snaps on strike).
  let lashStretch = 0;
  let gelTime = 0;   // clock for the gelatinous (ooze) squash jiggle

  let state: EnemyState = options?.dormant ? 'dormant' : 'idle';
  let phaseTimer = 0;
  let aliveLocal = true;

  // ── Poise / stagger ────────────────────────────────────────────────
  // A hidden pool the player's heavy/Might-scaled hits chip at; break it
  // and the enemy is STAGGERED (its action cancelled, a free-hit + EXECUTE
  // window). Pool resets on break and regenerates after a grace window so
  // chip pressure must be SUSTAINED. Default scales a bit above HP so a
  // stagger weapon earns the break over ~2-3 committed hits (a charged heavy
  // halves that); tanks set an explicit higher `poise`. Bosses get a much
  // larger pool (rarely staggered unless spec-tuned).
  const poiseMax = spec.poise ?? (spec.isBoss ? initialHp * 3 : Math.max(4, Math.round(initialHp * 1.4)));
  let poiseLeft = poiseMax;
  let poiseRegenCd = 0;     // grace countdown before the pool refills
  let staggerTimer = 0;     // > 0 while in the 'staggered' state
  // ── Cinematic entrance (ceiling-drop) ──────────────────────────────
  // A dormant boss with entrance:'ceiling-drop' waits HIDDEN above the arena
  // (only its floor blob-shadow shows the landing spot), then plummets to the
  // floor on wake with an impact quake — timed inside the engage grace.
  const isCeilingDrop = spec.entrance === 'ceiling-drop';
  const DROP_HEIGHT = 4.5;        // metres above the floor it waits / falls from
  const ENTRANCE_DUR = 0.55;      // seconds the drop takes
  let entranceTimer = -1;         // -1 = inactive; counts up while dropping
  let entranceImpactDone = false;
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
  let abilities = resolveAbilities(spec, phases ? currentAbilities : undefined);
  // Commit distance — the farthest range at which ANY ability triggers.
  // Beyond this the enemy just chases to close. Equals attackRange for a
  // pure melee mob, the cast range for a shooter.
  const commitDistance = abilities.reduce((m, a) => Math.max(m, a.maxRange), 0);
  let currentAbility: Ability | null = null;
  const cooldowns = new Map<string, number>();
  // Stagger each ability's FIRST use by a small random delay so a pack
  // spawned together (the king's split princes) doesn't cast in unison.
  // Deterministic via the run-seeded rng.
  for (const ab of abilities) cooldowns.set(ab.id, gameRng() * 0.9);
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
  // The lash tentacle — spawned for a 'lash' telegraph, reaches out over
  // the windup, snaps on strike, retracts + disposes on recover.
  let lashTendril: LashTendril | null = null;
  function clearAoeTelegraph() {
    if (aoeTelegraph) { aoeTelegraph.dispose(); aoeTelegraph = null; }
  }
  function clearLashTendril() {
    if (lashTendril) { lashTendril.dispose(); lashTendril = null; }
  }

  // Perception state. lastSeenPos tracks the last known XZ of the player
  // for searching. Updated each frame the enemy currently has LOS.
  let aggroed = false;
  let dormantLocal = false;   // mirrored to the public `dormant` getter
  let wasDormant = false;     // edge-detect the wake to grant an engage grace
  let timeSinceLOS = 0;             // seconds since enemy last had LOS to player
  const homePos = position.clone();  // post the enemy returns to when calm

  // Join the pack coordinator so a crowd of chasers rings the player instead of
  // piling on one point (src/mobs/pack.ts). `active` = actually in the fight
  // this frame; reach = strike range (the ring radius). Left on teardown via
  // disposeEnemy. The ring is for MELEE; ranged kiters keep their own standoff.
  joinPack(entityId, container.position, spec.strikeRange,
    () => aliveLocal && (state === 'chasing' || state === 'winding' || state === 'striking' || state === 'recovering'),
    () => state === 'winding' || state === 'striking' || state === 'recovering');
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
  let strideAccum = gameRng() * 0.4;   // footstep cadence accumulator (m); jittered so a pack doesn't step in lockstep
  // Last position we saw the player at. Used by 'searching' state.
  const lastSeenPos = new THREE.Vector3();

  // Per-spec aggro params with defaults.
  const sightRange = spec.sightRange ?? 7;
  const sightRangeSq = sightRange * sightRange;
  const sightConeCos = Math.cos(spec.sightConeHalfAngle ?? 1.05);
  const hearingRange = spec.hearingRange ?? 2.5;
  const hearingRangeSq = hearingRange * hearingRange;
  // Peripheral sight — notice a player in ANY direction (with LOS) within this
  // range, even outside the cone. Fixes "only aggros when I'm on top of it".
  const peripheralRange = spec.peripheralRange ?? CONFIG.ENEMY_AI.PERIPHERAL_RANGE;
  const peripheralRangeSq = peripheralRange * peripheralRange;
  const loseSightTime = spec.loseSightTime ?? 4;

  // Apply idle eyes immediately so unseen enemies don't pop with full-bright
  // eyes on the very first frame (before update runs even once).
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

  // Charge-recoil speed (the dash's contact knockback). The impulse itself is
  // owned + integrated by the body animator (bodyAnim.applyKnockback / tick).
  const KNOCKBACK_CHARGE = 4.5;

  // Pathfinding state — cached waypoints to the current target. Refreshed
  // every PATH_REFRESH seconds while LOS to the target is blocked. Phasing
  // mobs (wraith) skip pathfinding entirely; they steer through props.
  let path: Waypoint[] = [];
  let pathTime = 0;
  let stuckT = 0;   // time spent pinned against geometry (drives the sidestep)
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
    const clampOpts = spec.phasing ? { ignoreObstacles: true } : undefined;
    const cx = container.position.x, cz = container.position.z;
    let resolved = walkable.clampMove(cx, cz, cx + dx * inv * step, cz + dz * inv * step, spec.collisionRadius, clampOpts);

    // Stuck → sidestep. If the forward move was almost fully blocked by geometry
    // (a prop corner, a wall), accumulate stuck time; once pinned, try sliding
    // PERPENDICULAR to the target — both sides, take whichever makes progress —
    // so the mob flows AROUND the obstacle instead of grinding into its face
    // ("tries to go around but can't"). Cheap: the two extra clamps only run
    // while genuinely pinned.
    const fwdMoved = Math.hypot(resolved.x - cx, resolved.z - cz);
    if (fwdMoved < step * 0.3) {
      stuckT += dt;
      if (stuckT > NAV_STUCK_TIME) {
        const px = -dz * inv, pz = dx * inv;   // unit perpendicular to the target dir
        const left = walkable.clampMove(cx, cz, cx + px * step, cz + pz * step, spec.collisionRadius, clampOpts);
        const right = walkable.clampMove(cx, cz, cx - px * step, cz - pz * step, spec.collisionRadius, clampOpts);
        const lMov = Math.hypot(left.x - cx, left.z - cz);
        const rMov = Math.hypot(right.x - cx, right.z - cz);
        const best = lMov >= rMov ? left : right;
        if (Math.max(lMov, rMov) > step * 0.3) resolved = best;   // a side is open — slide
      }
    } else {
      stuckT = 0;
    }
    // Footstep foley — accumulate the distance ACTUALLY moved (post-clamp, so
    // a mob pinned against a wall goes silent) and tick a locomotion sound
    // every stride. Stride scales with body size so a stoneguard plods and a
    // rat patters. Spectral mobs (wraiths) drift in silence — they don't walk.
    if (vocalArch && spec.presence !== 'spectral') {
      const mdx = resolved.x - container.position.x;
      const mdz = resolved.z - container.position.z;
      strideAccum += Math.sqrt(mdx * mdx + mdz * mdz);
      const stride = 0.42 + spec.collisionRadius * 0.9;
      if (strideAccum >= stride) {
        strideAccum = 0;
        playEnemyFootstep(vocalArch, container.position);
      }
    }
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
    // Multi-phase boss: invuln window on phase entry (e.g. the
    // skeleton's downed-and-rising animation).
    if (phases && phaseInvulnTimer > 0) return 0;
    const entity = getEntity(entityId);
    if (!entity || !entity.hp) return 0;
    const result = computeDamage(event);
    entity.hp.current = Math.max(0, entity.hp.current - result.applied);
    // Phase part-break thresholds — fire at-most-once per threshold.
    if (phases) {
      const phase = phases[phaseIndex];
      if (phase.partBreaks) {
        for (let i = 0; i < phase.partBreaks.length; i++) {
          if (firedPartBreaks.has(i)) continue;
          if (entity.hp.current <= phase.partBreaks[i].atHp) {
            firedPartBreaks.add(i);
            hidePartsByName(phase.partBreaks[i].hideParts);
          }
        }
      }
    }
    coreReactor.hit();   // hit flash + glowing-core flare/pop (king)
    // Pained cry when it survives the blow — the creature's voice on top of
    // the weapon's impact, so every connecting hit reads as "I hurt it." The
    // death path has its own (heavier) collapse sound, so skip if this killed.
    if (entity.hp.current > 0 && vocalArch) playEnemyHurt(vocalArch, container.position);
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
      // Multi-phase: if there's a next phase, transition INSTEAD of dying —
      // animated collapse over the invuln window (see enterNextPhase).
      if (phases && phaseIndex + 1 < phases.length) {
        enterNextPhase(true);
        return result.applied;
      }
      // Killed mid-windup — drop any pending AoE marker / lash tentacle so
      // it doesn't linger after the caster is gone.
      clearAoeTelegraph();
      clearLashTendril();
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
      leavePack(entityId);   // killed mobs don't hit disposeEnemy — leave here
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
      // Exit the instancing batch: free the shared slots and re-show the
      // per-enemy meshes (they carry the per-enemy dissolvable materials),
      // so the dissolve ramp below runs exactly as it always has. No-op on
      // the legacy path.
      releaseCreatureInstancing(entityId, { corpse: true });
      // Tidy the stun ring + any leftover dizzy tumble if it died staggered.
      stunStars?.dispose(); stunStars = null;
      built.group.rotation.y = 0; built.group.rotation.z = 0;
      emit({ type: 'enemy:killed', enemyId: spec.id });
      // Death soaks the floor: a big pool under the corpse plus a
      // directional spray thrown by the killing blow (away from the
      // player), in the species' own blood.
      const gore = spec.bloodAmount ?? 1;
      if (gore > 0.01) {
        const bloodC = spec.bloodColor ?? 0x5e1210;
        stampSplat(container.position.x, container.position.z, (0.7 + Math.random() * 0.4) * gore, bloodC, 0.9 * gore);
        // The kill detonates: full-energy splash away from the player,
        // cardinal fallback so dying AGAINST a wall always marks it.
        emitGoreSplash(
          container.position.x, container.position.z,
          0.7 + Math.random() * 0.4,
          container.position.x - lastPlayerXZ.x,
          container.position.z - lastPlayerXZ.z,
          1.4 * gore, bloodC,
          { wallFallbackCardinals: true, sizeMul: Math.min(1.8, 0.75 + spec.collisionRadius * 0.9) },
        );
      }
      // Split-on-death — fire the builder's spawn callback so any
      // children appear in the same frame's enemy list. Pass a CLONE
      // of the death position because the builder may need it after
      // we've moved on (and clone is cheap).
      if (onDeath) onDeath(spec, container.position.clone(), entityId);
      // Start the death animation. Essence emits CONTINUOUSLY during
      // the dissolve — see tickDying. Gold coins drop now as physical
      // floor pickups with bundled value.
      deathTimer = 0;
      essenceRigY = essenceRigYDefault;
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

  // Chip the poise pool; break it → STAGGER. Called from the combat
  // cone on a heavy melee hit, with the attacker's already-resolved
  // stagger power (weapon weight × Might × charge — see attack.ts).
  function applyStaggerDamage(amount: number): boolean {
    if (!aliveLocal || burrowState !== 'surfaced' || amount <= 0) return false;
    if (state === 'staggered') return false;       // already reeling
    if (phases && phaseInvulnTimer > 0) return false;   // boss phase-entry invuln
    poiseLeft -= amount;
    poiseRegenCd = CONFIG.POISE.REGEN_DELAY;
    if (poiseLeft <= 0) { triggerStagger(); return true; }
    return false;
  }

  function triggerStagger(): void {
    // Cancel whatever it was doing — the wind-up/strike is INTERRUPTED.
    currentAbility = null;
    clearAoeTelegraph();
    clearLashTendril();
    setEyeFlare(0);
    // Visual punctuation of the break: a white hit-flash on the body (the
    // player-side cue — popup/sound/crunch — fires from attack.ts).
    coreReactor.hit();
    state = 'staggered';
    staggerTimer = CONFIG.POISE.STAGGER_DURATION;
    phaseTimer = 0;
    poiseLeft = poiseMax;          // reset — must be broken again
    poiseRegenCd = CONFIG.POISE.REGEN_DELAY;
    aggroed = true;                // a staggered mob is very much aware of you
    setStaggerVuln(true);          // expose any openWhenStaggered weak points
    // (Audio: the breaking hit's own hurt cry — via takeDamage — covers
    // the moment. A dedicated heavier "stagger" SFX is future polish.)
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

  // (setEyeFlare / applyIdleEyes live above as eye-presenter aliases.)

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
    // Creatures drive the swing through their archetype clip (the override fires
    // on the windup edge); skip the legacy pose so they don't fight over the
    // shoulders. The eye-flare telegraph still plays for everyone.
    if (!usesClipAttacks) applyTelegraphPose(telegraphNodes, style as TelegraphStyle | undefined, phase, t);
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
        // Aim at the player's eye height (playerPos IS camera.position — the
        // same reference the projectile hit-test uses), NOT flat at the muzzle
        // height. A low muzzle (e.g. the ground-hugging acid-spitter at y≈0.4)
        // would otherwise fly level UNDER the player's vertical hit window
        // (|dy| < 1.2) and never connect. Chest-height shooters (acolyte) are
        // unaffected — their muzzle already sits at player height.
        tmpTarget.set(t.x, playerPos.y, t.z);
        const count = action.count ?? 1;
        if (count <= 1) {
          spawnProjectile({
            typeId: action.projectileId, origin: tmpMuzzle, target: tmpTarget,
            damage: action.damage, source: entityId,
          });
        } else {
          // Fan: spread `count` projectiles around the centreline by
          // rotating the muzzle→target vector horizontally. Total spread
          // is symmetric around 0 (centre shard goes straight at the
          // anchor; outer shards lean ±spreadDeg/2). The shard radius
          // each carries `damage` independently — stacking is real.
          const spreadRad = ((action.spreadDeg ?? 18) * Math.PI) / 180;
          const dx0 = tmpTarget.x - tmpMuzzle.x;
          const dz0 = tmpTarget.z - tmpMuzzle.z;
          const dist = Math.hypot(dx0, dz0) || 1;
          for (let i = 0; i < count; i++) {
            // -0.5..+0.5 across the count, scaled to spreadRad.
            const f = count === 1 ? 0 : i / (count - 1) - 0.5;
            const ang = f * spreadRad;
            const c = Math.cos(ang), s = Math.sin(ang);
            const dxR = dx0 * c - dz0 * s;
            const dzR = dx0 * s + dz0 * c;
            // Re-project to roughly the same distance so all shards
            // share a launch speed and arc.
            const k = dist / Math.hypot(dxR, dzR);
            tmpFanTarget.set(tmpMuzzle.x + dxR * k, tmpTarget.y, tmpMuzzle.z + dzR * k);
            spawnProjectile({
              typeId: action.projectileId, origin: tmpMuzzle, target: tmpFanTarget,
              damage: action.damage, source: entityId,
            });
          }
        }
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
          bodyAnim.applyKnockback(
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
    // Lash — grow a slime tentacle out of the body toward the player. It
    // reaches over the windup (driven in the winding state), so it both
    // telegraphs and IS the attack. Reach = the lash's melee reach.
    if (ability.pose === 'lash') {
      const melee = ability.steps.find((st) => st.action.kind === 'melee')?.action;
      const reach = melee && melee.kind === 'melee' ? melee.reach : 3.0;
      clearLashTendril();
      lashTendril = spawnLashTendril(container, aimHeightResolved, reach, 0xa8ff44);
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
    // Peripheral sight: within peripheralRange, a clear line of sight is enough
    // — no cone. (Long-range detection past peripheralRange still needs the cone
    // below, so a distant player outside the gaze stays unseen — stealth holds.)
    if (distSq < peripheralRangeSq) {
      return walkable.hasLineOfSight(
        container.position.x, container.position.z, playerPos.x, playerPos.z,
      );
    }
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
    const lift = spec.presence === 'spectral'
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
    eyePresenter.setHaloOpacity(Math.max(0, 1 - t));

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
      // spawns hit the cached compile). POOLED geometries (the shared
      // primitive pool + the instancing segment cache) are shared across
      // every mob of the type — never dispose those.
      built.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry && !isPooledGeometry(mesh.geometry)) {
          mesh.geometry.dispose();
        }
      });
    }
  }

  // ── Per-frame animation/audio overlays ──────────────────────────────
  // Cosmetic + audio steps that run every aware/active frame regardless of
  // AI state. Pulled out of update() so the state machine reads clean; each
  // is a nested closure so it keeps direct access to the model refs.

  // Emit a positional vocalisation in "living its life" states (not
  // mid-attack). Agitated when hunting; calm + sparse at post.
  function tickVocalisation(dt: number, distToPlayer: number) {
    if (!vocalArch) return;
    vocalTimer -= dt;
    if (vocalTimer > 0) return;
    const agitated = state === 'chasing' || state === 'searching';
    const canVocalize = state === 'idle' || state === 'returning' || agitated;
    if (canVocalize) {
      playEnemyVocal(vocalArch, container.position, agitated);
      // Cadence: hunting = frequent; idle FAR = sparse (silence-first dread);
      // idle NEAR the player = a "stir" so a lurking mob reliably announces
      // itself as you approach (hear-before-see), without chattering room-wide.
      if (agitated) vocalTimer = 2.5 + gameRng() * 3;
      else if (distToPlayer < VOCAL_STIR_RANGE) vocalTimer = 3 + gameRng() * 3;
      else vocalTimer = 6 + gameRng() * 8;
    } else {
      vocalTimer = 1.5;   // mid-attack — retry shortly
    }
  }

  // Head-crane / knockback / locomotion / presence overlays live in the body
  // animator (enemy-animation.ts), driven from update() below.

  function update(dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid) {
    lastPlayerXZ.copy(playerPos);
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
        blob.visible = true;   // grounded now — reveal the contact shadow
      }
      return;
    }

    // Hit flash + glowing-core heartbeat/flare (see enemy-presentation.ts).
    coreReactor.tick(dt);

    // Phase entry invuln window (e.g. skeleton's downed → crawl rise).
    if (phases && phaseInvulnTimer > 0) phaseInvulnTimer = Math.max(0, phaseInvulnTimer - dt);

    // Phase-transition collapse — ease the body into the crawl pose while
    // he's down. He's INERT here (early return skips all AI/movement/
    // abilities) and already invulnerable (phaseInvulnTimer gate above), so
    // the fall plays out untouched, then normal AI resumes as the crawler.
    if (phaseFallActive && phaseFallNode) {
      phaseFallElapsed += dt;
      const t = phaseFallDuration > 0 ? Math.min(1, phaseFallElapsed / phaseFallDuration) : 1;
      const e = t * t;   // ease-IN: knees buckle slow, then he drops fast
      phaseFallNode.position.y = phaseFallFromY + (phaseFallToY - phaseFallFromY) * e;
      built.group.rotation.x = phaseFallFromPitch + (phaseFallToPitch - phaseFallFromPitch) * e;
      if (t >= 1) {
        phaseFallNode.position.y = phaseFallToY;
        built.group.rotation.x = phaseFallToPitch;
        phaseFallActive = false;
      }
      return;
    }

    // Capture home yaw the very first tick so idle scan rotates around the
    // actual placed-orientation (set by builder via faceWorld at spawn).
    if (!homeYawSet) {
      homeYaw = container.rotation.y;
      scanTargetYaw = homeYaw;
      homeYawSet = true;
    }

    // Vocalisation — hear it before you see it. (see tickVocalisation)
    tickVocalisation(dt, distToXZ(playerPos));

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

    // A dormant boss (the king behind its fog gate) stays inert — no
    // perception, no aggro — until the player COMMITS by entering the gate
    // (the encounter engages). Souls-style: the fight starts when you cross
    // the threshold, not when the boss spots you from across the room.
    // Gated on the fog wall existing so a fog-less boss can't deadlock
    // (it would never engage without the cross trigger).
    const dormant = !!spec.dormantUntilEngaged && levelHasFogWall() && !isBossEncounterEngaged();
    if (wasDormant && !dormant) {
      // Just woke (player committed at the fog gate). A grace beat before
      // the first assault so the player can orient coming out of the
      // walk-in — the boss closes the distance but holds fire. Push every
      // ability onto a short cooldown (only lengthens, never shortens an
      // already-staggered one).
      for (const ab of abilities) {
        cooldowns.set(ab.id, Math.max(cooldowns.get(ab.id) ?? 0, ENGAGE_GRACE));
      }
      // Ceiling-drop entrance: reveal + start the plummet (the impact quake
      // fires when it lands, below). Plays inside the grace window.
      if (isCeilingDrop) { built.group.visible = true; entranceTimer = 0; }
    }
    wasDormant = dormant;
    dormantLocal = dormant;
    if (dormant) {
      aggroed = false;
      if (state !== 'idle') { state = 'idle'; phaseTimer = 0; }
      // Ceiling-drop bosses hide above the arena until the cross — the blob
      // shadow on the floor is the only tell of where they'll land.
      if (isCeilingDrop) built.group.visible = false;
    }

    // ── Perception ─────────────────────────────────────────────────────
    // Refresh sight check every frame. Once aggroed, we stay aggroed
    // until loseSightTime seconds pass with no LOS AND we've transitioned
    // out of mid-attack states (winding/striking/recovering finish before
    // we drop aggro).
    const seesPlayer = !dormant && canSeePlayer(playerPos, walkable);
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

    // Poise regen — once the player stops landing stagger pressure, the
    // pool refills (a grace delay, then a steady rate) so you must
    // SUSTAIN hits to break it. A staggered enemy doesn't regen (its
    // pool is already reset for the next break).
    if (state !== 'staggered') {
      if (poiseRegenCd > 0) poiseRegenCd = Math.max(0, poiseRegenCd - dt);
      else if (poiseLeft < poiseMax) {
        poiseLeft = Math.min(poiseMax, poiseLeft + CONFIG.POISE.REGEN_RATE * dt);
      }
    }

    // Face target is conditional — idle/returning faces the scan target,
    // not the player; a staggered enemy is reeling and doesn't track you.
    if (state !== 'idle' && state !== 'returning' && state !== 'staggered') {
      faceTarget(playerPos);
    }

    switch (state) {
      case 'dormant': {
        // No perception, no movement, no idle scan, no vocalisation.
        // Only check is "did the boss-bar engagement flip on?" — the
        // fog-wall cross trigger flips it, and that's our wake
        // signal. We jump straight to chasing so the bar appearing,
        // the boss intro, and the boss starting to hunt all land on
        // the SAME frame the player crosses the threshold.
        if (isBossEngaged()) {
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }
      case 'staggered': {
        // Poise broken — reel in place, can't act. A DIZZY TUMBLE: recoil back,
        // then wobble + spin around the model's own axis like a cartoon
        // character seeing stars (eased out as it recovers), eyes dimmed, the
        // stun-star ring orbiting overhead. The openWhenStaggered weak points
        // are exposed this whole window. The free-hit the player earned.
        staggerTimer -= dt;
        const elapsed = CONFIG.POISE.STAGGER_DURATION - staggerTimer;
        // Dizzy for the first ~1.5s (spin + drunken lean), then SETTLE into a
        // slumped, head-down stun with a gentle sway for the rest of the long
        // window — reads "down for a beat", not spinning forever.
        const wob = Math.max(0, 1 - elapsed / 1.5);
        applyTilt(-0.45 - 0.25 * wob);                                  // stays slumped back
        built.group.rotation.y = Math.sin(elapsed * 15) * 0.4 * wob;    // dizzy spin
        built.group.rotation.z = Math.sin(elapsed * 11) * 0.18 * wob + Math.sin(elapsed * 2.2) * 0.06;
        applyIdleEyes();              // eyes go dim — visibly stunned, not glaring
        built.group.position.y = 0;
        if (!stunStars) {
          // Place the ring above the model's ACTUAL top (bounding box), not a
          // guessed height — a tall body (stoneguard) otherwise buries the
          // stars in its chest. Computed once, on the first stagger.
          built.group.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(built.group);
          const top = isFinite(box.max.y) ? box.max.y - container.position.y : aimHeightResolved * 1.5;
          stunStars = createStunStars(container, top + 0.4);
        }
        if (staggerTimer <= 0) {
          applyTilt(0);
          built.group.rotation.y = 0;
          built.group.rotation.z = 0;
          setStaggerVuln(false);   // close the exposed weak point
          state = 'chasing';
          phaseTimer = 0;
        }
        break;
      }
      case 'idle': {
        // Dormant boss (king behind its fog gate): hold dead STILL — no
        // gaze scan, no alerts. It's asleep, looming, until you commit.
        // (The constant left-right idle scan reads as a twitchy giant.)
        if (dormant) {
          applyIdleEyes();
          applyTilt(0);
          built.group.position.y = 0;
          break;
        }
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
        eyePresenter.applySearch();
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
        // Gate the commit on a pack ATTACK TOKEN — only ATTACK_TOKENS mobs may
        // be mid-attack at once. A mob that wants to attack but can't get a
        // token falls through to movement below: it holds the ring and prowls,
        // waiting its turn (the pack takes turns lunging instead of all swinging
        // at once). Bosses + lone mobs are unaffected (a token is always free).
        const ability = selectAbility(distance);
        if (ability && requestToken(entityId)) {
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
            // Melee/charger, or a kiter that's genuinely out of range — move to
            // the PACK target: a slot on the ring at strike distance along this
            // mob's bearing (+ separation), so a crowd surrounds the player
            // instead of stacking on one point. Falls back to the player's
            // position if unregistered.
            const ringTarget = packMoveTarget(entityId, playerPos, packScratch());
            const tx = ringTarget ? ringTarget.x : playerPos.x;
            const tz = ringTarget ? ringTarget.z : playerPos.z;
            moveTowards(tx, tz, moveSpeed, dt, walkable, nav);
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
        if (lashTendril) lashTendril.setProgress(t);   // tentacle reaches out over the windup
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
          playEnemyStrike(audioSizeFor(spec), container.position);  // the attack RELEASE bark
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
        if (lashTendril) lashTendril.snap();            // tentacle snaps out + flares on the strike
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
        if (lashTendril) lashTendril.setProgress(Math.max(0, 1 - t));   // retract the tentacle
        if (phaseTimer >= currentAbility.recover) {
          // ±18% jitter so packs drift out of sync over the fight.
          cooldowns.set(currentAbility.id, (currentAbility.cooldown ?? 0) * (0.82 + gameRng() * 0.36));
          currentAbility = null;
          clearAoeTelegraph();   // safety — normally disposed at strike
          clearLashTendril();
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
    // Zero the vertical base BEFORE the overlays. They ADD their bob/dip to
    // group.position.y each frame; without a clean base, any AI state that
    // forgets to reset y lets the presence dip ACCUMULATE (~+0.4 m/s upward —
    // the "floating away" bug). One reset here makes the overlays drift-proof.
    built.group.position.y = 0;
    // Ceiling-drop entrance — override the base y while parked above / falling.
    // Parked at DROP_HEIGHT while dormant (hidden); on wake it accelerates down
    // (ease-in = gravity) and slams the floor with a quake. The presence bob
    // below then stacks normally once it's landed (entranceTimer past the dur).
    if (isCeilingDrop) {
      if (dormant) {
        built.group.position.y = DROP_HEIGHT;
      } else if (entranceTimer >= 0 && entranceTimer < ENTRANCE_DUR) {
        entranceTimer += dt;
        const t = Math.min(1, entranceTimer / ENTRANCE_DUR);
        built.group.position.y = DROP_HEIGHT * (1 - t * t);   // ease-in fall
        if (t >= 1 && !entranceImpactDone) {
          entranceImpactDone = true;
          kickShake(0.6, 0.5);   // the slam
        }
      }
    }
    bodyAnim.tickHeadCrane(dt, distance, aggroed && state !== 'returning');
    bodyAnim.tickKnockback(dt, walkable);
    bodyAnim.tickLocomotion(dt);
    bodyAnim.tickPresence(dt);
    tickLashDeform(dt);
    tickClipAnimator(dt);
    // Stun-star ring — orbits while staggered, fades out after (so it lingers a
    // beat as the mob shakes it off). No-op until the first stagger builds it.
    stunStars?.tick(dt, state === 'staggered');
  }

  /** Drive the keyframe animator from AI state. setBase responds to
   *  locomotion changes (idle ↔ walk ↔ crawl); playOverride fires once
   *  on the windup edge with the ability's clip stretched to the FULL
   *  windup+strike+recover window. */
  function tickClipAnimator(dt: number): void {
    if (!clipAnimator || !animBundle) return;
    const bundle = animBundle;
    // Decide base layer from state + phase.
    const phase = phases ? phases[phaseIndex] : null;
    const useCrawl = phase?.useCrawlAnimation && bundle.crawl;
    const movingState =
      state === 'chasing' || state === 'searching' || state === 'returning';
    const baseClip = movingState
      ? (useCrawl ? bundle.crawl! : bundle.walk)
      : bundle.idle;
    clipAnimator.setBase(baseClip);
    // Fire an override on the WINDUP edge — exactly once per ability cast.
    // We watch for (state, ability) tuple changes; entering 'winding' with
    // a different ability than last time = new cast.
    const inWindup = state === 'winding' && currentAbility;
    const abId = inWindup ? currentAbility!.id : null;
    const transitioned =
      prevAnimState !== state ||
      prevAnimAbilityId !== abId ||
      prevAnimPhaseIndex !== phaseIndex;
    if (transitioned && inWindup && abId) {
      const clip = bundle.abilities[abId];
      if (clip && currentAbility) {
        const total = currentWindupTime + currentAbility.strike + currentAbility.recover;
        clipAnimator.playOverride(clip, total);
      }
    }
    // Stagger drops any in-flight override so the reel reads.
    if (state === 'staggered' && prevAnimState !== 'staggered') {
      clipAnimator.cancelOverride();
    }
    prevAnimState = state;
    prevAnimAbilityId = abId;
    prevAnimPhaseIndex = phaseIndex;
    clipAnimator.update(dt);
  }

  // Lash deform — on a 'lash' telegraph the body ELONGATES toward the
  // player (the slime rears + reaches a pseudopod), squashing slightly on
  // the other axes (volume-ish), then SNAPS forward on the strike. Eases
  // back to base scale whenever not lashing. Scale is otherwise untouched
  // by the animation layers (which use position/rotation), so it's free.
  function tickLashDeform(dt: number) {
    const lashing = currentAbility?.pose === 'lash';
    let target = 0;
    let ease = dt * 9;
    if (lashing && state === 'winding') {
      target = 0.5 * Math.min(1, phaseTimer / currentWindupTime);   // rear up slowly
    } else if (lashing && state === 'striking') {
      target = 1.0;                                                  // snap forward
      ease = dt * 26;
    }
    lashStretch += (target - lashStretch) * Math.min(1, ease);
    if (target === 0 && lashStretch < 0.002) lashStretch = 0;
    // GELATINOUS jiggle (blobs/oozes) — a continuous squash-and-stretch about
    // the resting volume so the jelly reads alive even standing still. Lives
    // here because tickLashDeform OWNS built.group.scale (a presence overlay
    // would be clobbered by this writer). Volume-ish: squash Y, bulge X/Z.
    let gx = 1, gy = 1, gz = 1;
    if (spec.presence === 'gelatinous') {
      gelTime += dt;
      const w = Math.sin(gelTime * 3.2) * 0.1;
      gy = 1 - w; gx = 1 + w * 0.5; gz = 1 + w * 0.5;
    }
    // Elongate along local Z (forward/back, the player axis since the
    // container faces the player); squash X/Y a touch.
    built.group.scale.set(
      groupBaseScale.x * gx * (1 - 0.12 * lashStretch),
      groupBaseScale.y * gy * (1 - 0.16 * lashStretch),
      groupBaseScale.z * gz * (1 + 0.55 * lashStretch),
    );
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
      case 'staggered':
        setEyeFlare(0);
        applyTilt(s === 'staggered' ? -0.4 : 0);
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

  function setDebugBossPhase(index: number) {
    if (!phases) return;
    // Step instantly up to the target phase (settled poses, no animation).
    while (phaseIndex < index && phaseIndex + 1 < phases.length) {
      enterNextPhase(false);
    }
    phaseInvulnTimer = 0;   // a posed phase shouldn't be mid-invuln
  }

  function debugAdvanceBossPhase() {
    enterNextPhase(true);   // animated collapse, as if just killed
  }

  function bossPhaseInfo() {
    return { index: phaseIndex, count: phases ? phases.length : 1 };
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
    aimHeight: aimHeightResolved,
    hurtbox,
    setZoneEnabled: (id: string, on: boolean) => setZoneEnabled(hurtbox, id, on),
    hitFeedback: 'heavy',
    bloodColor: spec.bloodColor ?? 0x6e1410,
    bloodAmount: spec.bloodAmount ?? 1,
    hitTargets: built.hitTargets,
    collisionRadius: spec.collisionRadius,
    hitRadius: spec.hitRadius ?? 0,
    noPlayerCollision: !!spec.noPlayerCollision,
    phasing: !!spec.phasing,
    get dormant() {
      return dormantLocal;
    },
    // Phase-aware: a multi-phase boss's max HP is the CURRENT phase's
    // pool (16 in P1, 12 in P2 for the Marrow Sovereign), not the
    // top-level spec.hp (which is 1 for phase-driven bosses — unused as
    // a real HP value). The boss bar reads this every frame to scale
    // the fill, so without this getter the bar would render at 1600%
    // fullness in P1 and look pinned to full until the boss dies.
    get maxHp() {
      return currentMaxHp;
    },
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
    // Finisher window: ONLY a poise-broken (STAGGERED) enemy is executable.
    // The old low-HP "chip execute" path is gone — execution is now purely the
    // reward for breaking poise, which is what makes the stagger game matter.
    // A heavy hit here executes — see attack.ts + CONFIG.EXECUTE.
    get executable() {
      if (!aliveLocal || phaseInvulnTimer > 0) return false;
      return state === 'staggered';
    },
    takeDamage,
    applyStaggerDamage,
    update,
    setDebugState,
    setDebugPosition,
    setDebugBossPhase,
    debugAdvanceBossPhase,
    bossPhaseInfo,
    faceWorld,
    applyKnockback: bodyAnim.applyKnockback,
  };
}
