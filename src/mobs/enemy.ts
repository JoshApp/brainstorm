import * as THREE from 'three';
import { CONFIG } from '../config';
import type { EnemySpec } from '../content/enemies';
import { DEFAULT_FACTION, threatensPlayer, type FactionId } from '../content/factions';
import {
resolveAbilities
} from '../content/abilities';
import { type TelegraphNodes } from './pose-clips';
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
import { createEnemyDeath, DEFAULT_SEVERABLE } from './enemy-death';
import { createBossPhases } from './boss-phases';
import { vocalArchetypeFor } from './enemy-overlays';
import { createEnemyBurrow } from './enemy-burrow';
import { buildSkinnedCreature } from './creature-skinned';
import { createBodyAnimator } from './enemy-animation';
import { createEnemyAction } from './enemy-action';
import { tagPerfEvent } from '../debug/perf-recorder';
import { Animator } from '../anim/animator';
import { type BuiltModel } from '../ecs/build-model';
import { buildCreature } from '../content/build-creature';
import type { Creature } from '../content/creature-types';
import { setEntityCombatStats, clearEntityCombatStats, registerDamageSink, unregisterDamageSink, type DamageEvent } from '../combat/damage';
import { createBlobShadow } from '../effects/blob-shadow';
import { joinPack, leavePack } from './pack';
import { rollPersonality } from './intent';
import type { Damageable } from '../combat/damageable';
import { setZoneEnabled, type Hurtbox } from '../combat/hurtbox';
import { gameRng } from '../engine/rng';
import { applyTilt } from './enemy-locomotion';
import { clearAoeTelegraph, clearLashTendril } from './enemy-abilities';
import { takeDamage, applyStaggerDamage, applyFear } from './enemy-damage';
import { update } from './enemy-brain';
import { reconcileThreat } from './enemy-overlays';
import type {
EnemyCtx, EnemyFsm, EnemyPresState, EnemyPoise, EnemyCombat, EnemyAwareness,
EnemyIntentState, EnemyIdle, EnemyAudio, EnemyLoco,
} from './enemy-ctx';

/** Release an enemy's ECS entity + registered combat stats. Called from level
 *  teardown for mobs the player LEFT ALIVE — those never hit the death path
 *  that frees them, so without this their entity + baseline stats leak into
 *  the world map across descents. Idempotent (killed mobs already freed). */
export function disposeEnemy(e: Enemy): void {
  e.clearThreat();   // pop any held deflect opportunity (no leak on teardown)
  e.releaseOverheadCues();   // hand the stun ring / fear skull's pooled clones back
  clearEntityCombatStats(e.entityId);
  unregisterDamageSink(e.entityId);
  destroyEntity(e.entityId);
  leavePack(e.entityId);
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

/** DEV telemetry for the mob-AI readout (see src/debug/mob-ai-readout.ts). */
export interface AiDebug {
  kind: string;
  state: EnemyState;
  intent: string;
  moveMode: string;
  release: boolean;
  yaw: number;          // body yaw, radians (the readout differentiates it → jitter)
  faceX: number; faceZ: number;   // the world point faceTarget last aimed at (blue gizmo)
  poise: number;        // 0..1 (poiseLeft / poiseMax)
  aggression: number;   // 0..1 mood
  boldness: number;
  patience: number;
  feint: boolean;       // a feint is actively driving movement
  decisionIn: number;   // s until the next intent re-decision
  cower: number;        // s of cower left (fleeing)
  broke: boolean;       // morale has broken this life
  fear: number;         // s of IMPOSED fear left (0 = only a spontaneous rout)
  openToBackstab: boolean;   // a blow to its back right now would be a backstab
}

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
  | 'staggered'   // poise broken by a heavy hit — reeling, can't act,
                  // a free-hit window (see the poise system + Might)
  | 'fleeing';

// Idle scan: the enemy drifts its gaze in a gentle random-walk around its
// home facing, holding still much of the time, so a roomful (especially a
// spider swarm) reads as watchful — not a row of heads slapping left-right
// in unison. Each gaze change is a SMALL step from the current angle, not a
// fresh jump across the whole arc, and the interval is jittered per enemy so
// the swarm desyncs.
const IDLE_SCAN_INTERVAL_MIN = CONFIG.ENEMY_AI.IDLE_SCAN_INTERVAL_MIN;

export interface Enemy extends Damageable {
  entityId: EntityId;
  /** Spec id from src/content/enemies.ts ('rat', 'skirmisher', etc.). */
  kind: string;
  /** Which side it's on (content/factions.ts). Drives whether it counts as a
   *  player-threat for room-clear. 'vermin' = neutral ambient life. */
  faction: FactionId;
  /** True for boss enemies — drives the boss bar (see ui/boss-bar.ts). */
  isBoss: boolean;
  /** True for MINIBOSS enemies — a named elite set-piece, a lesser tier than a
   *  boss (amber bar, minor rest-fire on death, no descent gate). Both isBoss
   *  and miniboss run through the same grand-encounter container. */
  miniboss: boolean;
  /** Boss/miniboss bar display name (only meaningful when isBoss || miniboss). */
  bossName: string;
  group: THREE.Group;
  /** Live alias of group.position — satisfies Damageable for the unified
   *  combat cone scan. */
  position: THREE.Vector3;
  hitTargets: THREE.Object3D[];
  alive: boolean;
  /** SUMMONED — conjured mid-fight by an arena wave, a summoner, or any other
   *  spawner. A summoned mob drops NOTHING: no items, no gold. Anything that can
   *  be produced on demand must never be a source of income, or the optimal play
   *  becomes standing in a room farming it. The reward for a summoned fight
   *  belongs to the ENCOUNTER that summoned it, paid once when it resolves. */
  summoned: boolean;
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
  /** Current body yaw (container.rotation.y) — read-only, for debug facing
   *  readouts (e.g. __mobPack's faceErr). */
  readonly yaw: number;
  /** Force any open deflect-flash threat OFF (pops a held deflect opportunity)
   *  — used by removal paths so the global opportunity count can't leak. */
  clearThreat(): void;
  /** Hand the overhead cues' pooled materials back. Called by disposeEnemy for
   *  mobs the player LEFT ALIVE — those skip the death path that tidies them. */
  releaseOverheadCues(): void;
  /** Impose FEAR for `seconds` — the creature routs and hangs a skull. Returns
   *  true if it took (refused for bosses, the dead, and anything still inside
   *  its post-fear immunity). See CONFIG.ENEMY_AI.FEAR. */
  applyFear(seconds: number): boolean;
  collisionRadius: number;
  /** Combat hit radius — swings reach the body's surface this far from
   *  `position`. Default 0 (point). See Damageable.hitRadius. */
  hitRadius: number;
  /** Height the swing cone aims at + where the damage number floats from. */
  aimHeight: number;
  /** DEV nav overlay: the mob's live cached path waypoints (empty when steering
   *  direct / phasing). Read-only view for debug rendering. */
  readonly debugPath?: readonly Waypoint[];
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
  /** DEV: a live snapshot of this mob's AI for the debug readout (diagnosing
   *  facing jitter etc.). Read-only, cheap. */
  aiDebug(): AiDebug;
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
   *  + AI + idle animation until the boss-engagement flag flips.
   *  `onSummon` is the SUMMON-GATE hook: when the boss wards itself it calls
   *  this to spawn its brood into the live level, and the builder returns the
   *  spawned bodies so the boss can watch them (its ward lifts when all die). */
  options?: {
    dormant?: boolean;
    onSummon?: (gate: NonNullable<EnemySpec['summonGate']>, atPos: THREE.Vector3) => Enemy[];
  },
): Enemy {
  tagPerfEvent(`spawn:${spec.id}`);
  // ── fsm: The state machine: which state, how long in it, alive or not.
  const fsm: EnemyFsm = {
    // Container: world position + yaw to face player.
    // SUMMONED — set by the spawner after construction (see the `summoned`
    // accessor on the returned Enemy). Lives in the closure so the death handler
    // reads the CURRENT value rather than a copy captured at build time.
    summoned: false,
    state: options?.dormant ? 'dormant' : 'idle',
    phaseTimer: 0,
    alive: true,
  };

  const container = new THREE.Group();
  container.position.copy(position);
  // Last seen player position — the death spray throws away from it.
  const lastPlayerXZ = new THREE.Vector3();

  // Skeleton-first creature: dimensions + hurtbox are MEASURED/derived by
  // buildCreature (docs/CREATURE-SYSTEM.md). The rest of this module consumes
  // `built` (group/parts/slots/materials/hitTargets) the same way regardless of
  // archetype, so presentation + animation are archetype-agnostic.
  const creature = buildCreature(spec.creature);        // builds + merges + measures internally
  const creatureRef: Creature = creature;               // for setJointVisible (part-breaks + dismember)
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
  // so the entity id keys the same lifecycle. Same id, same lifecycle.
  const entityId = generateEntityId(`enemy-${spec.id}`);
  // Render path: fold the creature's per-joint segments into ONE rigid-skinned
  // SkinnedMesh (docs/CREATURE-RENDER-V2.md). The joints ARE the bones; the live
  // joint animation drives the GPU deform. Flash/dissolve/core-reactor key off
  // the shared built.materials (which the skinned mesh reuses), so they work
  // unchanged. The handle is kept for dismember/part-breaks (collapsing a limb
  // out of the single mesh — joint.visible does nothing to GPU-skinned verts).
  const skinnedCreature = buildSkinnedCreature(creature);
  // WARM the debris templates while we're behind the load screen (or, for a
  // combat summon, on its spawn frame — a species cache hit makes this free).
  // Without it the FIRST kill of a species pays the chunk vertex bake
  // mid-fight; with it every kill, first included, reuses shared geometry.
  skinnedCreature.bakeChunkTemplates(spec.id, spec.severable ?? DEFAULT_SEVERABLE);
  // Base model scale, captured for the lash deform (which elongates the
  // body toward the player on a 'lash' telegraph, then eases back here).
  const groupBaseScale = built.group.scale.clone();
  // ── pres: Presentation bookkeeping: overhead cues, clip edges, threat flash, body deforms, the entrance.
  const pres: EnemyPresState = {
    // "Seeing stars" stun ring — lazily built the first time this mob is staggered
    // (most never are), parented to the container above the head.
    stunStars: null,
    // Fear skull — same lazy story as the stun ring: most creatures never break,
    // so it is built the first time this one is frightened and not before.
    fearSkull: null,
    prevAnimState: null,
    prevAnimAbilityId: null,
    prevAnimPhaseIndex: -1,
    threatOn: false,
    threatDeflectable: false,
    // Lash deform — eased 0..1 body elongation toward the player during a
    // 'lash' telegraph (the slime rears + reaches, then snaps on strike).
    lashStretch: 0,
    /** Cast wind-up inflation — see tickLashDeform. */
    castSwell: 0,
    // clock for the gelatinous (ooze) squash jiggle
    gelTime: 0,
    // accelerating pulse clock for an armed blast
    fuseBeatPhase: 0,
    // -1 = inactive; counts up while dropping
    entranceTimer: -1,
    entranceImpactDone: false,
  };

  // Tag this container as an inspection subject — main.ts's inspect
  // block hides level siblings (walls/floor/torches/decor) but keeps
  // anything tagged here visible. Zero cost in gameplay mode; the
  // userData flag is just read in the one inspect setup branch.
  container.userData.inspectSubject = true;

  scene.add(container);

  // Burrowed floor ambush (mobs/enemy-burrow.ts): buried + inert until the
  // player comes near, then it bursts out.
  const burrow = createEnemyBurrow(spec, built, container, blob);

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
  // PER-MOB clips only: a mob drives attacks via a clip when it authors its OWN
  // bundle (spec.animation — see clips-mobs.ts). No shared archetype fallback
  // anymore (the one BIPED_SMASH that made every biped move alike is retired);
  // a mob without its own clip telegraphs via the phase-keyed POSE system below.
  const animBundle = spec.animation;
  const usesClipAttacks = !!animBundle;
  const clipAnimator = animBundle
    ? new Animator(built.slots, animBundle.joints)
    : null;
  // Visual presentation controllers — the eye-flare windup telegraph and the
  // hit/core-glow flash. Both own their material refs internally (see
  // enemy-presentation.ts). Thin local aliases keep the AI state machine's
  // setEyeFlare/applyIdleEyes call sites below unchanged.
  const eyePresenter = createEyePresenter(built, spec);
  const coreReactor = createCoreReactor(built, spec, skinnedCreature.mesh);
  const setEyeFlare = eyePresenter.setFlare;
  const applyIdleEyes = eyePresenter.applyIdle;

  // ── Reactive-defense threat flash ───────────────────────────────────
  // As a reachable melee strike commits, the eyes flash: WHITE = deflectable
  // (tap to parry → stagger), RED = unblockable (must dodge). A deflectable
  // flash also registers a parry OPPORTUNITY so the tap arbiter routes a tap
  // to deflect instead of swing. reconcileThreat is idempotent and called
  // once per frame from the AI tick — it pushes/pops the global opportunity
  // count only on edges, so a mid-windup death/stagger can't leak the count.
  const THREAT_DEFLECT_COLOR = new THREE.Color(CONFIG.DEFLECT.FLASH_COLOR);
  const THREAT_UNBLOCK_COLOR = new THREE.Color(CONFIG.DEFLECT.UNBLOCK_COLOR);

  // World entity (HP + buffs). For multi-phase bosses, HP starts at
  // phase[0].hp; phase transitions refill to the next phase's HP.
  // (entityId was generated above, before the instancing acquire.)
  // Phases + summon gate (mobs/boss-phases.ts). The enemy side of a phase
  // change — abilities, HP, poise, AI state — comes back through the hooks.
  const phases = spec.phases ?? null;
  const bossPhases = createBossPhases(
    { spec, built, container, creature: creatureRef, skinned: skinnedCreature, coreReactor, tiltPart, onSummon: options?.onSummon },
    {
      // Pop any OPEN deflect opportunity the dying-into-next-phase ability held —
      // a phase transition fires from takeDamage and RETURNS before the death-path
      // pop, and the phase-fall then early-returns from update() for a beat, so
      // reconcileThreat wouldn't run to clear it. Same leak the death path guards.
      leaving: () => reconcileThreat(self, false, false),
      entered: (next) => {
        combat.abilities = resolveAbilities(spec, next.abilities, stepInCfg, CONFIG.MOB_STRIKE_CONTACT_FRAC);
        const ent = getEntity(entityId);
        if (ent?.hp) { ent.hp.base = next.hp; ent.hp.current = next.hp; }
        // Per-phase poise: a phase can become UNSTUNNABLE (high poise) or flimsier.
        // Refill the pool on entry regardless — a new phase is a fresh stagger bar.
        if (next.poise !== undefined) poise.poiseMax = next.poise;
        poise.poiseLeft = poise.poiseMax;
        clearAoeTelegraph(self);
        clearLashTendril(self);
        fsm.state = 'chasing';
        fsm.phaseTimer = 0;
      },
    },
  );
  const initialHp = bossPhases.initialHp;
  spawnEntity({
    id: entityId,
    kind: 'enemy',
    hp: { base: initialHp, current: initialHp },
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
  registerDamageSink(entityId, (event) => takeDamage(self, event));   // `self` exists by the time any damage lands
  // ── poise: Poise (the stagger pool) and morale (rout, cower, fear).
  const poise: EnemyPoise = {
    // ── Poise / stagger ────────────────────────────────────────────────
    // A hidden pool the player's heavy/Might-scaled hits chip at; break it
    // and the enemy is STAGGERED (its action cancelled, a free-hit + EXECUTE
    // window). Pool resets on break and regenerates after a grace window so
    // chip pressure must be SUSTAINED. Default scales a bit above HP so a
    // stagger weapon earns the break over ~2-3 committed hits (a charged heavy
    // halves that); tanks set an explicit higher `poise`. Bosses get a much
    // larger pool (rarely staggered unless spec-tuned).
    // A phase may override poise (a very high value = effectively unstunnable);
    // phase[0]'s override wins at spawn, else the spec/default. `let` so a phase
    // transition can raise or lower it.
    poiseMax: phases?.[0].poise ?? spec.poise ?? (spec.isBoss ? initialHp * 3 : Math.max(4, Math.round(initialHp * 1.4))),
    poiseLeft: 0,
    // grace countdown before the pool refills
    poiseRegenCd: 0,
    // cooldown after a FALTER so heavy hits can't chain-lock a windup forever
    falterCd: 0,
    // Morale: a creature's nerve can BREAK (low HP roll, weighted by how bold it
    // is; or its leader falling) → it routs + cowers ('fleeing'). Breaks at most
    // once per life (a re-engaged coward then fights on), so no perma-flee flicker.
    brokenOnce: false,
    // >0 while cowering at the end of a rout
    cowerTimer: 0,
    // FEAR — the same rout, but IMPOSED rather than rolled. While `fearTimer > 0`
    // the creature will not re-engage no matter how long it has cowered; it is
    // simply too frightened to turn around. `fearCd` is the anti-permalock cooldown
    // (CONFIG.ENEMY_AI.FEAR.IMMUNE_AFTER) that keeps break→panic→break from
    // removing the fight entirely. See applyFear.
    fearTimer: 0,
    fearCd: 0,
  };
  poise.poiseLeft = poise.poiseMax;

  // Action-layer authority — owns the interrupt beats (stagger + parry
  // flinch-lock) and the cancel table. The mob mirror of the player FSM;
  // see enemy-action.ts. The big EnemyState machine below still drives
  // behaviour, but "can I act / can I be staggered" lives in one place.
  const actionFsm = createEnemyAction();
  // ── Cinematic entrance (ceiling-drop) ──────────────────────────────
  // A dormant boss with entrance:'ceiling-drop' waits HIDDEN above the arena
  // (only its floor blob-shadow shows the landing spot), then plummets to the
  // floor on wake with an impact quake — timed inside the engage grace.
  const isCeilingDrop = spec.entrance === 'ceiling-drop';
  const stepEvents = new Set<string>();

  // ── Abilities ──────────────────────────────────────────────────────
  // A ROOTED mob never steps in. Not a special case for the lasher — it's the
  // general rule: if a thing cannot walk, its swing cannot carry it forward.
  // Without this, giving every melee attack a default step-in would have quietly
  // taught the floor-anchored plant to stroll toward you.
  const stepInCfg = spec.moveSpeed > 0 ? CONFIG.ENEMY_AI.STEP_IN : undefined;
  // ── combat: The ability runner: the kit, the cast in progress, its steps and telegraphs.
  const combat: EnemyCombat = {
    /** PLANT — seconds a ranged mob must hold its ground after loosing a shot.
     *  A kiter used to drop straight from `recovering` into its retreat, so it was
     *  already backpedalling while its own bolt was still in the air: from the
     *  player's side that reads as "it shoots at random while running away," which
     *  is exactly the report. Standing in the shot it just took makes the attack a
     *  discrete, committed act you can punish. */
    plantTimer: 0,
    // ── Strike-phase timeline state ────────────────────────────────────
    // Per-step latches for the ability currently striking: stepStarted[i]
    // flips once step i's trigger fires; stepDone[i] once its action fully
    // resolves (an instant hit, a melee landing, a dash contacting, a leap
    // landing). stepEvents collects events ('jump:land') that later steps'
    // triggers wait on. All reset at strike start. Per-step, never shared —
    // so two steps can't latch each other off (the old shared-flag bug).
    stepStarted: [],
    stepDone: [],
    // The attack runner is fully ability-driven. Enemies without an
    // explicit `abilities` list get one default ability synthesized from
    // their legacy fields (see resolveAbilities). `currentAbility` is the
    // one being executed across winding/striking/recovering; `cooldowns`
    // tracks per-ability lockout so a charge can't fire every second.
    abilities: resolveAbilities(spec, phases ? bossPhases.initialAbilities : undefined, stepInCfg, CONFIG.MOB_STRIKE_CONTACT_FRAC),
    currentAbility: null,
    // Set the instant a melee step CONNECTS (deals damage). Once a strike has
    // landed, it's spent — the threat flash drops and a late tap can no longer
    // "parry" a blow you already ate. Reset when a new ability commits (winding).
    meleeHitLanded: false,
    // AoE telegraph state — the ground marker shown during an aoe ability's
    // windup, and the world point it's locked to (resolved at strike).
    aoeTelegraph: null,
    // The lash tentacle — spawned for a 'lash' telegraph, reaches out over
    // the windup, snaps on strike, retracts + disposes on recover.
    lashTendril: null,
    // True when the live telegraph is anchored to THIS mob rather than to a
    // ground spot — it must be dragged along each windup frame (see the winding
    // state), otherwise a creeping caster leaves its own danger ring behind.
    aoeTelegraphFollowsSelf: false,
    // Inside-aura state — how long the player has been inside us +
    // when the next dot tick is due. Resets to 0 when player leaves.
    auraInsideTime: 0,
    auraDamageTimer: 0,
    // Per-cycle randomized windup duration so multiple enemies attacking in
    // unison de-synchronize over time (otherwise stacked mobs all strike on
    // the exact same frame and the player has no rhythm to read).
    currentWindupTime: 0,
    /** Run one ability action this frame. Returns true when the action is
     *  DONE (no more per-frame work): an instant hit resolves once; a melee
     *  keeps trying until it lands or the strike ends; dash/leap run their
     *  whole motion. Each action owns its own resolution — nothing is shared
     *  between steps (that sharing is what broke the old leap). */
    // ── Detonation ────────────────────────────────────────────────────
    // A blast can be delivered two ways — the timeline firing it on schedule, or
    // the caster being killed while ARMED (see armedBlastAction). Both funnel
    // here so they can't drift apart, and `blastSpent` guarantees a bomb goes off
    // exactly once: without it, selfDestruct → takeDamage → the death hook → a
    // second blast → selfDestruct again is an obvious infinite recursion.
    blastSpent: false,
  };
  combat.currentWindupTime = combat.abilities[0].windup;

  // Commit distance — the farthest range at which ANY ability triggers.
  // Beyond this the enemy just chases to close. Equals attackRange for a
  // pure melee mob, the cast range for a shooter.
  const commitDistance = combat.abilities.reduce((m, a) => Math.max(m, a.maxRange), 0);
  const cooldowns = new Map<string, number>();
  // Stagger each ability's FIRST use by a small random delay so a pack
  // spawned together (the king's split princes) doesn't cast in unison.
  // Deterministic via the run-seeded rng.
  for (const ab of combat.abilities) cooldowns.set(ab.id, gameRng() * 0.9);
  // The locked landing/impact point — the 'lockedTarget' anchor. Snapshot
  // of the player's position when the windup begins (an aoe resolves on
  // it, a leap arcs onto it).
  const aoeTarget = new THREE.Vector3();
  // The 'landing' anchor — where the last leap touched down, for a
  // follow-up step (a puddle) to build on.
  const landing = new THREE.Vector3();
  // ── aware: Perception: aggro, dormancy, line of sight.
  const aware: EnemyAwareness = {
    // Perception state. lastSeenPos tracks the last known XZ of the player
    // for searching. Updated each frame the enemy currently has LOS.
    aggroed: false,
    // mirrored to the public `dormant` getter
    dormant: false,
    // edge-detect the wake to grant an engage grace
    wasDormant: false,
    // seconds since enemy last had LOS to player
    timeSinceLOS: 0,
  };

  const homePos = position.clone();  // post the enemy returns to when calm

  // ── Intent layer (Enemy AI V2 — docs/ENEMY-AI-V2.md) ────────────────
  // A chasing mob picks an INTENT (close/circle/watch/press) on a slow decision
  // tick and HOLDS its attacks until an aggressive intent releases one — so the
  // fight breathes (size-up → burst) instead of shuffling and swinging on
  // cooldown. `aggression` is a drifting mood; `personality` is spawn-rolled so a
  // pack has a coward and a berserker. BOSSES OPT OUT (useIntent=false) — they
  // keep constant pressure, so their carefully tuned fights are untouched.
  const personality = rollPersonality(gameRng, spec.disposition);
  // ── intent: Enemy AI V2 intent layer: mood, the current choice, feints.
  const intent: EnemyIntentState = {
    aggression: CONFIG.ENEMY_AI.INTENT.MOOD_TARGET_BASE + personality.boldness * 0.2,
    // desync the first decision
    decisionTimer: gameRng() * CONFIG.ENEMY_AI.INTENT.DECISION_MIN,
    currentIntent: { intent: 'close', moveMode: 'close', speedMul: 1, releaseAttack: false },
    /** Seconds since this mob last committed an attack — drives the intent
     *  starvation pressure (see selectIntent). Only ticks while engaged. */
    sinceCommit: 0,
    // Feint (telegraph-the-wait): while HOLDING the ring, fake a lunge now and then
    // so a waiting mob reads as coiled, not frozen. `feintCd` counts down between
    // feints; `feintT` runs a feint (-1 = idle).
    feintCd: CONFIG.ENEMY_AI.INTENT.FEINT_MIN + gameRng() * CONFIG.ENEMY_AI.INTENT.FEINT_JITTER,
    feintT: -1,
  };

  const useIntent = !spec.isBoss && !spec.miniboss;
  /** True while the creature is visibly panicked — drives the skull + backstab. */
  const isFeared = (): boolean => poise.fearTimer > 0 || fsm.state === 'fleeing';

  // Join the pack coordinator so a crowd of chasers rings the player instead of
  // piling on one point (src/mobs/pack.ts). `active` = actually in the fight
  // this frame; reach = strike range (the ring radius). Left on teardown via
  // disposeEnemy. The ring is for MELEE; ranged kiters keep their own standoff.
  joinPack(entityId, container.position, spec.strikeRange,
    () => fsm.alive && (fsm.state === 'chasing' || fsm.state === 'winding' || fsm.state === 'striking' || fsm.state === 'recovering'),
    () => fsm.state === 'winding' || fsm.state === 'striking' || fsm.state === 'recovering');
  // ── idle: Calm behaviour: home post, vermin wander, idle scan.
  const idle: EnemyIdle = {
    // Capture spawn yaw as "home yaw" so idle scan / returning faces back the
    // way the level placed us. Set after initial faceWorld() in builder.ts —
    // for now, read whatever rotation is on the container right now.
    // filled in on first idle-tick
    homeYaw: 0,
    homeYawSet: false,
    // Ambient WANDER (non-hostile vermin — maggots): a slow crawl between random
    // nearby points with a grub wriggle, so they read as ALIVE, not props. Home is
    // the spawn spot; the crawl stays within a small radius of it.
    homeX: 0,
    homeZ: 0,
    homeSet: false,
    wanderX: 0,
    wanderZ: 0,
    wanderActive: false,
    wanderPause: 0,
    wanderTimer: 0,
    // Idle scan yaw target — rotates in place to feel watchful.
    // pick a new target immediately
    scanTimer: IDLE_SCAN_INTERVAL_MIN,
    scanInterval: IDLE_SCAN_INTERVAL_MIN,
    scanTargetYaw: 0,
  };

  const wrigglePhase = gameRng() * Math.PI * 2;
  // Leap takeoff point, captured at strike start — a leap action arcs
  // from here to the locked landing zone. (Its once-only touchdown is
  // latched by the step's stepDone, like every other action.)
  const leapStart = new THREE.Vector3();

  // Vocalisation — positional idle/aware sound so the player hears the mob
  // before they see it. Staggered first utterance so a roomful doesn't fire
  // in unison; the global throttle in sfx caps overlap.
  const vocalArch = vocalArchetypeFor(spec);
  // ── audio: Vocal and footstep cadence (seeded from gameRng at spawn).
  const audio: EnemyAudio = {
    vocalTimer: 2 + gameRng() * 8,
    // footstep cadence accumulator (m); jittered so a pack doesn't step in lockstep
    strideAccum: gameRng() * 0.4,
  };

  // Last position we saw the player at. Used by 'searching' state.
  const lastSeenPos = new THREE.Vector3();

  // Faction gate — a mob only HUNTS the player if its faction is hostile to the
  // delver. A neutral (vermin) never aggros: sight is ignored, shared alerts are
  // ignored, and taking a hit doesn't make it give chase. It just lives there.
  const hostileToPlayer = threatensPlayer(spec.faction);

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
  function rollWindupTime() {
    const base = combat.currentAbility?.windup ?? combat.abilities[0].windup;
    combat.currentWindupTime = base * (0.78 + gameRng() * 0.44);  // ±22%
  }
  rollWindupTime();
  // ── loco: Locomotion: the cached route, stuck detection, smoothed facing.
  const loco: EnemyLoco = {
    // Pathfinding state — cached waypoints to the current target. Refreshed
    // every PATH_REFRESH seconds while LOS to the target is blocked. Phasing
    // mobs (wraith) skip pathfinding entirely; they steer through props.
    path: [],
    pathTime: 0,
    // time spent pinned against geometry (drives the sidestep)
    stuckT: 0,
    // Smoothed velocity for movement-facing. Face where the mob is ACTUALLY moving
    // (real per-frame displacement, low-passed), so a chaser turns to RUN where it
    // goes instead of crab-walking / moonwalking with its body facing elsewhere.
    // When it's essentially stationary (watching, blocked, arrived) it faces the
    // player instead. The smoothing + the min-speed gate filter the per-frame noise
    // from pack separation + pathfinding that made facing a raw target jitter.
    smoothVelX: 0,
    smoothVelZ: 0,
    dbgFaceX: 0,
    // DEV: the point faceTarget last aimed at (blue gizmo)
    dbgFaceZ: 0,
  };

  // Death sequence — the killing blow, the topple/crumble/fade, the dissolve
  // and the essence (mobs/enemy-death.ts). The DEATH STYLE ('collapse' topples
  // then dissolves; 'fade' dissolves in place, spectral default; 'crumble'
  // drops real bone pieces) is authored per enemy.
  const death = createEnemyDeath({
    scene, container, built, spec, skinned: skinnedCreature, eyes: eyePresenter,
    essenceRigY: essenceRigYDefault,
  });
  const _faceMove = new THREE.Vector3();
  // Shared context for the lifted subsystems (mobs/enemy-*.ts).
  const self: EnemyCtx = {
    _faceMove,
    actionFsm,
    aimHeightResolved,
    animBundle,
    aoeTarget,
    applyIdleEyes,
    audio,
    aware,
    bodyAnim,
    bossPhases,
    built,
    burrow,
    clipAnimator,
    combat,
    commitDistance,
    container,
    cooldowns,
    coreReactor,
    death,
    entityId,
    eyePresenter,
    fsm,
    groupBaseScale,
    hearingRangeSq,
    homePos,
    hostileToPlayer,
    hurtbox,
    idle,
    intent,
    isCeilingDrop,
    isFeared,
    landing,
    lastPlayerXZ,
    lastSeenPos,
    leapStart,
    loco,
    loseSightTime,
    onDeath,
    peripheralRangeSq,
    personality,
    poise,
    pres,
    rollWindupTime,
    scene,
    setEyeFlare,
    sightConeCos,
    sightRangeSq,
    spec,
    stepEvents,
    telegraphNodes,
    THREAT_DEFLECT_COLOR,
    THREAT_UNBLOCK_COLOR,
    tiltPart,
    useIntent,
    usesClipAttacks,
    vocalArch,
    wrigglePhase,
  };


  function setDebugState(s: EnemyState, t: number) {
    fsm.state = s;
    fsm.phaseTimer = t;
    // Clear the timeline latches (debug poses don't run a real cast).
    combat.stepStarted = [];
    combat.stepDone = [];
    stepEvents.clear();
    switch (s) {
      case 'chasing':
      case 'staggered':
        setEyeFlare(0);
        applyTilt(self, s === 'staggered' ? -0.4 : 0);
        built.group.position.y = 0;
        break;
      case 'winding': {
        const f = Math.min(1, t / spec.windupTime);
        setEyeFlare(f);
        applyTilt(self, 0.5 * f);
        built.group.position.y = 0.10 * f;
        break;
      }
      case 'striking':
        setEyeFlare(1);
        applyTilt(self, -0.25);
        built.group.position.y = 0;
        break;
      case 'recovering': {
        const f = Math.min(1, t / spec.recoverTime);
        setEyeFlare(1 - f);
        applyTilt(self, THREE.MathUtils.lerp(-0.25, 0, f));
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
    bossPhases.debugJumpTo(index);
  }

  function debugAdvanceBossPhase() {
    bossPhases.enterNext(true);   // animated collapse, as if just killed
  }

  function bossPhaseInfo() {
    return { index: bossPhases.index, count: bossPhases.count };
  }

  function faceWorld(x: number, z: number) {
    // PURE YAW (x/z = 0). The old lookAt left rotation.x/z = ±π for -Z-hemisphere
    // targets; that flip persisted into the per-frame yaw-only facing and
    // inverted the model (the moonwalk). Keep spawn/override facing clean.
    container.rotation.x = 0;
    container.rotation.z = 0;
    container.rotation.y = Math.atan2(x - container.position.x, z - container.position.z) + Math.PI;
  }

  return {
    entityId,
    kind: spec.id,
    faction: spec.faction ?? DEFAULT_FACTION,
    // Backed by the closure flag above so the death handler (which closes over
    // it) sees what the spawner set. Set AFTER construction — createEnemy has no
    // summon context of its own. See builder.spawnInto's `summoned` option.
    get summoned() { return fsm.summoned; },
    set summoned(v: boolean) { fsm.summoned = v; },
    isBoss: !!spec.isBoss,
    miniboss: !!spec.miniboss,
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
    get debugPath() { return loco.path; },   // DEV nav overlay — the live cached route
    get dormant() {
      return aware.dormant;
    },
    // Phase-aware: a multi-phase boss's max HP is the CURRENT phase's
    // pool (16 in P1, 12 in P2 for the Marrow Sovereign), not the
    // top-level spec.hp (which is 1 for phase-driven bosses — unused as
    // a real HP value). The boss bar reads this every frame to scale
    // the fill, so without this getter the bar would render at 1600%
    // fullness in P1 and look pinned to full until the boss dies.
    get maxHp() {
      return bossPhases.maxHp;
    },
    get alive() {
      return fsm.alive;
    },
    get dying() {
      return death.dying;
    },
    get hp() {
      const e = getEntity(entityId);
      return e?.hp?.current ?? 0;
    },
    get aiState() {
      return fsm.state;
    },
    /** DEBUG: current body yaw (container.rotation.y) for facing readouts. */
    get yaw() {
      return container.rotation.y;
    },
    /** Force any open deflect-flash threat OFF (pops a held deflect
     *  opportunity). Called on removal paths so the global opportunity count
     *  can't leak when a flashing mob is torn down without a normal threat
     *  reconcile. */
    clearThreat() {
      reconcileThreat(self, false, false);
    },
    releaseOverheadCues() {
      pres.stunStars?.dispose(); pres.stunStars = null;
      pres.fearSkull?.dispose(); pres.fearSkull = null;
    },
    applyFear: (seconds: number) => applyFear(self, seconds),
    /** Body FORWARD is (−sin yaw, −cos yaw) — Three's −Z forward turned by the
     *  container yaw. The combat cone reads this to tell a blow to the back from
     *  a blow to the flank. */
    get facingYaw() {
      return container.rotation.y;
    },
    // The creature's own verdict on whether a blow from behind is a BACKSTAB —
    // stated here rather than reassembled from state flags in the combat layer,
    // because "can it answer me" is a question only it can answer. Two ways to
    // be open, and they bracket the fight: it has not noticed you (the opener),
    // or its nerve is broken (the punish you earned by breaking it).
    //
    // Bosses and minibosses are never open: their pressure curve is tuned, and
    // a dormant one waiting behind its fog gate would otherwise eat a free
    // opener for the crime of standing still.
    get openToBackstab() {
      if (!fsm.alive || aware.dormant || spec.isBoss || spec.miniboss) return false;
      // Ambient vermin are never open: a maggot is PERMANENTLY unaware, so
      // without this every crawling thing on the floor is a free BACKSTAB beat
      // and the word stops meaning anything. Sneaking up on something that was
      // never going to fight you is not an achievement.
      if (!hostileToPlayer) return false;
      return !aware.aggroed || isFeared();
    },
    // Finisher window: ONLY a poise-broken (STAGGERED) enemy is executable.
    // The old low-HP "chip execute" path is gone — execution is now purely the
    // reward for breaking poise, which is what makes the stagger game matter.
    // A heavy hit here executes — see attack.ts + CONFIG.EXECUTE.
    get executable() {
      if (!fsm.alive || bossPhases.phaseInvulnerable || bossPhases.summonInvulnerable) return false;
      return fsm.state === 'staggered';
    },
    aiDebug(): AiDebug {
      return {
        kind: spec.id, state: fsm.state, intent: intent.currentIntent.intent, moveMode: intent.currentIntent.moveMode,
        release: intent.currentIntent.releaseAttack, yaw: container.rotation.y,
        faceX: loco.dbgFaceX, faceZ: loco.dbgFaceZ,
        poise: poise.poiseMax > 0 ? Math.max(0, poise.poiseLeft / poise.poiseMax) : 1, aggression: intent.aggression,
        boldness: personality.boldness, patience: personality.patience,
        feint: intent.feintT >= 0, decisionIn: intent.decisionTimer, cower: poise.cowerTimer, broke: poise.brokenOnce,
        fear: poise.fearTimer, openToBackstab: !hostileToPlayer ? false : (!aware.aggroed || isFeared()),
      };
    },
    takeDamage: (event: DamageEvent) => takeDamage(self, event),
    applyStaggerDamage: (amount: number) => applyStaggerDamage(self, amount),
    update: (dt: number, playerPos: THREE.Vector3, walkable: WalkableRegion, nav?: NavGrid) => update(self, dt, playerPos, walkable, nav),
    setDebugState,
    setDebugPosition,
    setDebugBossPhase,
    debugAdvanceBossPhase,
    bossPhaseInfo,
    faceWorld,
    applyKnockback: bodyAnim.applyKnockback,
  };
}
