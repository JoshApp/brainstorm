// The shape of one enemy, as its subsystems see it.
//
// createEnemy (mobs/enemy.ts) builds an enemy once at spawn and hands every
// subsystem the same `self: EnemyCtx`: the per-enemy parts, the subsystems
// that own their own state, the mutable state grouped by concern, and the
// tuning resolved from the spec at spawn. The subsystems are plain functions
// over it:
//
//   enemy-brain.ts        update(): the per-frame FSM — perception, intent, the
//                         11 states, the post-AI overlays
//   enemy-abilities.ts    the ability runner: select, telegraph, run each
//                         action (melee, projectile, dash, aoe, blast, leap, field)
//   enemy-damage.ts       takeDamage, poise and stagger, morale and fear, parry
//   enemy-locomotion.ts   moveTowards (pathing, stuck sidestep, footsteps),
//                         facing, arcs, feints
//   enemy-perception.ts   canSeePlayer
//   enemy-overlays.ts     clip animator, lash deform, vocalisation, threat flash
//
// and the ones that own their state outright: enemy-death.ts, boss-phases.ts,
// enemy-burrow.ts, enemy-presentation.ts, enemy-animation.ts, enemy-action.ts.
//
// Rule for new state: it goes in the group whose concern it is (or a new
// group), never as a loose closure variable — a loose `let` captured into
// `self` would be copied once and go stale.
//
// tests/enemy-golden.test.ts pins the behaviour of the whole assembly.

import type * as THREE from 'three';
import type { EnemySpec } from '../content/enemies';
import type { Ability } from '../content/abilities';
import type { AnimationBundle } from '../content/enemy-types';
import type { BuiltModel } from '../ecs/build-model';
import type { Hurtbox } from '../combat/hurtbox';
import type { AoeTelegraph } from '../effects/aoe-telegraph';
import type { LashTendril } from '../effects/lash-tendril';
import type { Waypoint } from '../level/nav-grid';
import type { VocalArchetype } from '../audio/sfx';
import type { Animator } from '../anim/animator';
import type { EnemyState, EnemyOnDeath } from './enemy';
import type { EnemyAction } from './enemy-action';
import type { BodyAnimator } from './enemy-animation';
import type { BossPhases } from './boss-phases';
import type { EnemyBurrow } from './enemy-burrow';
import type { CoreReactor, EyePresenter } from './enemy-presentation';
import type { EnemyDeath } from './enemy-death';
import type { IntentChoice, Personality } from './intent';
import type { TelegraphNodes } from './pose-clips';
import type { StunStars } from './stun-stars';
import type { FearSkull } from './fear-skull';

export interface EnemyCtx {
  // ── Parts ──────────────────────────────────────────────────────────
  spec: EnemySpec;
  scene: THREE.Object3D;
  /** World position + yaw. */
  container: THREE.Group;
  /** The creature model (joints are its slots). */
  built: BuiltModel;
  entityId: string;
  hurtbox: Hurtbox;
  tiltPart: THREE.Object3D | undefined;
  groupBaseScale: THREE.Vector3;
  /** Measured body centre × scale: where swings aim and numbers float. */
  aimHeightResolved: number;
  telegraphNodes: TelegraphNodes;
  onDeath: EnemyOnDeath | undefined;

  // ── Subsystems that own their state ───────────────────────────────
  actionFsm: EnemyAction;
  bodyAnim: BodyAnimator;
  bossPhases: BossPhases;
  burrow: EnemyBurrow;
  death: EnemyDeath;
  eyePresenter: EyePresenter;
  coreReactor: CoreReactor;
  clipAnimator: Animator | null;
  animBundle: AnimationBundle | undefined;
  usesClipAttacks: boolean;
  applyIdleEyes: () => void;
  setEyeFlare: (t: number) => void;
  /** Re-roll the windup length (±22%) for the next cast. */
  rollWindupTime: () => void;
  isFeared: () => boolean;

  // ── Mutable state, by concern ─────────────────────────────────────
  fsm: EnemyFsm;
  pres: EnemyPresState;
  poise: EnemyPoise;
  combat: EnemyCombat;
  aware: EnemyAwareness;
  intent: EnemyIntentState;
  idle: EnemyIdle;
  audio: EnemyAudio;
  loco: EnemyLoco;
  /** Per-ability lockout, seconds. */
  cooldowns: Map<string, number>;
  /** Events ('jump:land') a strike's later steps wait on. Reset per strike. */
  stepEvents: Set<string>;
  // Per-enemy points (never share these across enemies).
  aoeTarget: THREE.Vector3;
  landing: THREE.Vector3;
  leapStart: THREE.Vector3;
  lastPlayerXZ: THREE.Vector3;
  lastSeenPos: THREE.Vector3;
  homePos: THREE.Vector3;
  /** Scratch for faceMovement. */
  _faceMove: THREE.Vector3;

  // ── Resolved from the spec at spawn ───────────────────────────────
  personality: Personality;
  /** Off for bosses and minibosses: set pieces keep tuned pressure. */
  useIntent: boolean;
  hostileToPlayer: boolean;
  /** The farthest range at which any ability triggers. */
  commitDistance: number;
  sightRangeSq: number;
  sightConeCos: number;
  hearingRangeSq: number;
  peripheralRangeSq: number;
  loseSightTime: number;
  isCeilingDrop: boolean;
  vocalArch: VocalArchetype | null;
  wrigglePhase: number;
  THREAT_DEFLECT_COLOR: THREE.Color;
  THREAT_UNBLOCK_COLOR: THREE.Color;
}

/** The state machine: which state, how long in it, alive or not. */
export interface EnemyFsm {
  summoned: boolean;
  state: EnemyState;
  phaseTimer: number;
  alive: boolean;
}

/** Presentation bookkeeping: overhead cues, clip edges, threat flash, body deforms, the entrance. */
export interface EnemyPresState {
  stunStars: StunStars | null;
  fearSkull: FearSkull | null;
  prevAnimState: EnemyState | null;
  prevAnimAbilityId: string | null;
  prevAnimPhaseIndex: number;
  threatOn: boolean;
  threatDeflectable: boolean;
  lashStretch: number;
  castSwell: number;
  gelTime: number;
  fuseBeatPhase: number;
  entranceTimer: number;
  entranceImpactDone: boolean;
}

/** Poise (the stagger pool) and morale (rout, cower, fear). */
export interface EnemyPoise {
  poiseMax: number;
  poiseLeft: number;
  poiseRegenCd: number;
  falterCd: number;
  brokenOnce: boolean;
  cowerTimer: number;
  fearTimer: number;
  fearCd: number;
}

/** The ability runner: the kit, the cast in progress, its steps and telegraphs. */
export interface EnemyCombat {
  plantTimer: number;
  stepStarted: boolean[];
  stepDone: boolean[];
  abilities: Ability[];
  currentAbility: Ability | null;
  meleeHitLanded: boolean;
  aoeTelegraph: AoeTelegraph | null;
  lashTendril: LashTendril | null;
  aoeTelegraphFollowsSelf: boolean;
  auraInsideTime: number;
  auraDamageTimer: number;
  currentWindupTime: number;
  blastSpent: boolean;
}

/** Perception: aggro, dormancy, line of sight. */
export interface EnemyAwareness {
  aggroed: boolean;
  dormant: boolean;
  wasDormant: boolean;
  timeSinceLOS: number;
}

/** Enemy AI V2 intent layer (docs/ENEMY-AI-V2.md): mood, the current choice, feints. */
export interface EnemyIntentState {
  aggression: number;
  decisionTimer: number;
  currentIntent: IntentChoice;
  sinceCommit: number;
  feintCd: number;
  feintT: number;
}

/** Calm behaviour: home post, vermin wander, idle scan. */
export interface EnemyIdle {
  homeYaw: number;
  homeYawSet: boolean;
  homeX: number;
  homeZ: number;
  homeSet: boolean;
  wanderX: number;
  wanderZ: number;
  wanderActive: boolean;
  wanderPause: number;
  wanderTimer: number;
  scanTimer: number;
  scanInterval: number;
  scanTargetYaw: number;
}

/** Vocal and footstep cadence (seeded from gameRng at spawn). */
export interface EnemyAudio {
  vocalTimer: number;
  strideAccum: number;
}

/** Locomotion: the cached route, stuck detection, smoothed facing. */
export interface EnemyLoco {
  path: Waypoint[];
  pathTime: number;
  stuckT: number;
  smoothVelX: number;
  smoothVelZ: number;
  dbgFaceX: number;
  dbgFaceZ: number;
}
