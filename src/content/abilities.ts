import type { Vec3 } from '../ecs/model-types';
import type { DamageType } from '../combat/damage';
import type { EntityId } from '../ecs/types';
import type { EnemySpec } from './enemies';

// Composable ability timeline — the data spine for "what an enemy does."
//
// Three layers:
//   - Ability   = the CONTAINER. Owns selection (range band) + cooldown,
//                 and the windup/strike/recover phase durations. The AI
//                 picks one of these to run.
//   - Step      = one beat on the container's TIMELINE: a trigger (WHEN)
//                 + an action (a primitive — WHAT happens).
//   - Anchors + Telegraphs = the CROSS-CUTTING systems that span steps.
//                 Anchors are the shared DATA (a leap writes `landing`; a
//                 follow-up field reads it). Telegraphs are the shared
//                 PRESENTATION (one tell can preview several steps).
//
// Design rule from the leap bug: every action owns its own lifecycle
// state (no shared "already fired" latch), and a telegraph is bound to
// what it predicts — so "what you see coming" and "what resolves" can't
// drift apart.
//
// New behaviour = add one Action kind + one handler in enemy.ts, then it
// composes freely with everything else on a timeline.

// ── Anchors — the shared data spine ───────────────────────────────
// A named point both actions and telegraphs resolve against. Some are
// LIVE (re-read each frame), some are SNAPSHOTS (committed at cast
// start), some are WRITTEN by an action mid-cast for a later step.
export type Anchor =
  | 'self'          // the caster's current position (live)
  | 'player'        // the player's current position (live — homing)
  | 'lockedTarget'  // player position SNAPSHOT at cast start ("where you
                    // WERE" — a slow giant can't course-correct, so kiting
                    // off the marker is the dodge)
  | 'landing';      // where the last movement action touched down — WRITTEN
                    // by leap, READ by a follow-up field/aoe

// ── Element — the cross-cut ───────────────────────────────────────
// A per-ACTION flavour tag, resolved through ELEMENTS below to a damage
// type (+ optionally a status buff + VFX palette). 'physical'/'arcane'
// are the neutral types (no status); fire/acid/frost bind their buff.
// Per-action on purpose: one combo can mix a PHYSICAL leap impact with a
// FIRE puddle.
export type Element = 'physical' | 'arcane' | 'fire' | 'acid' | 'frost';

/** Element → mechanical resolution. The buff (when present) is the status
 *  the element applies on hit; fire→burn, acid→poison, frost→chill — the
 *  buffs already exist in ecs/buffs. 'physical'/'arcane' are pure damage
 *  types with no status, so existing attacks migrate onto them with zero
 *  behaviour change. */
export const ELEMENTS: Record<Element, { damageType: DamageType; buff?: string; buffDuration?: number }> = {
  physical: { damageType: 'physical' },
  arcane:   { damageType: 'magic' },
  fire:     { damageType: 'physical', buff: 'burn',   buffDuration: 2.5 },
  acid:     { damageType: 'magic',    buff: 'poison', buffDuration: 4.0 },
  frost:    { damageType: 'magic',    buff: 'chill',  buffDuration: 3.0 },
};

/** Legacy DamageType → neutral Element (physical→physical, magic→arcane).
 *  Used when compiling legacy flat-field enemies, so they keep their exact
 *  damage type with no status added. */
export function elementForDamageType(dt?: DamageType): Element {
  return dt === 'magic' ? 'arcane' : 'physical';
}

// ── Attribution — the kill flows through every part to the unit ───
// Every hit an ability deals is stamped with a DamageSource. `unit` is
// always the enemy performing the ability — what kill-credit + aggro key
// on. ability/step/element ride alongside so a MULTI-PART ability credits
// the right part, and LINGERING parts (a field tick, a projectile hit)
// carry their source forward so delayed damage still attributes to the
// unit's ability. (Today only `.unit` is consumed; Phase 5 narration
// reads the rest.)
export interface DamageSource {
  unit: EntityId;
  abilityId?: string;
  stepId?: string;
  element?: Element;
}

// ── Actions — the primitive library ───────────────────────────────
// Each kind is ONE runtime handler. DAMAGE lives on the action that deals
// it — an instant leap splash and a lingering field carry their own
// numbers; there is no single ability-wide damage.
export type AbilityAction =
  // Contact swing at trigger time if the player is within reach.
  | { kind: 'melee'; reach: number; damage: number; element?: Element }
  // Fire a bolt from a muzzle toward an anchor (default: player).
  | { kind: 'projectile'; projectileId: string; muzzle: Vec3; damage: number; toward?: Anchor }
  // Drive the caster toward/away from an anchor for the strike, contact-
  // hitting within reach. toward:'player' homes; 'lockedTarget' commits.
  | { kind: 'dash'; toward: Anchor; speed: number; contactReach: number; damage: number; element?: Element }
  // Instantaneous ground zone resolved at `origin`. 'self' = radial slam,
  // 'lockedTarget' = stomp-where-you-were.
  | { kind: 'aoe'; origin: Anchor; radius: number; damage: number; element?: Element }
  // Committed airborne jump onto `toward` (a snapshot anchor). Arcs there
  // over the strike, splashes `damage` on landing, shakes + shoves — and
  // WRITES the `landing` anchor on touchdown so a later step can build on
  // the impact point. Emits a 'land' event for event-triggers.
  | { kind: 'leap';
      toward: Anchor; arcHeight: number; landingRadius: number; damage: number;
      shake?: number; shakeDuration?: number; knockbackSpeed?: number;
      minDistance?: number; element?: Element }
  // Drop a PERSISTENT hazard field at `origin` for `lifetime` seconds — a
  // stationary aura that slows + ticks (`dps`) anyone standing in it. The
  // king's body-aura, detached and left on the floor (the slow puddle).
  | { kind: 'field';
      origin: Anchor; radius: number; lifetime: number;
      slow?: number; dps?: number; dotInterval?: number; element?: Element };

/** Durative actions run every frame for the strike window (dash/leap);
 *  the rest resolve once at their trigger. */
export function isDurativeAction(a: AbilityAction): boolean {
  return a.kind === 'dash' || a.kind === 'leap';
}

// ── Triggers — WHEN a step fires ──────────────────────────────────
export type Trigger =
  | { at: number }                                     // seconds into the timeline
  | { after: string; on: 'land' | 'contact' | 'end' }; // an earlier step's event

export interface Step {
  /** Optional id so event-triggers + telegraph spans can name this step. */
  id?: string;
  trigger: Trigger;
  action: AbilityAction;
  /** Telegraph scoped to just this step. Ability-level telegraphs live on
   *  the container. (aoe/leap actions auto-raise a ground ring if none is
   *  declared — see the runtime.) */
  telegraph?: Telegraph;
}

// ── Telegraphs — the presentation track ───────────────────────────
// Anchored, span-scoped tells. Two registers that LAYER: intent
// (body-charge/eye-flare = "something big, now") over spatial
// (ground-ring/hazard-outline/beam = "exactly HERE"). Binding to an
// anchor lets ONE tell honestly preview several steps.
export type TelegraphKind =
  | 'ground-ring' | 'hazard-outline' | 'beam-line'
  | 'body-charge' | 'eye-flare';

export interface Telegraph {
  kind: TelegraphKind;
  anchor?: Anchor;
  radius?: number;
  span?: { from?: 'windup' | string; to?: string };
}

// ── Ability — the container ───────────────────────────────────────
export interface Ability {
  id: string;
  minRange?: number;
  maxRange: number;
  cooldown?: number;
  // Phase durations (seconds). windup = pre-commit reaction window
  // (telegraphs ramp, no action fires); strike = the active window the
  // timeline runs over; recover = locked follow-through (cooldown starts
  // at its end).
  windup: number;
  strike: number;
  recover: number;
  /** The timeline. */
  steps: Step[];
  /** Ability-scoped telegraphs (intent register + any spatial tell that
   *  should span multiple steps). */
  telegraphs?: Telegraph[];
  /** Body pose flavour for the intent telegraph. */
  pose?: 'swing' | 'cast' | 'charge';
  /** Creep toward the player during windup so a stationary player still
   *  gets clipped by a melee. Charges/leaps don't. Default: true when the
   *  first step is a melee. */
  creep?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Reach of the first melee action, for windup-creep targeting. null if
 *  the ability opens on something else. */
export function firstMeleeReach(ability: Ability): number | null {
  const a = ability.steps[0]?.action;
  return a && a.kind === 'melee' ? a.reach : null;
}

/** Whether the ability wants windup creep (explicit, else true iff it
 *  opens on a melee). */
export function wantsCreep(ability: Ability): boolean {
  return ability.creep ?? (ability.steps[0]?.action.kind === 'melee');
}

/** Synthesize the default ability from an enemy's legacy flat fields, as
 *  a one-step timeline — so every enemy that doesn't declare `abilities`
 *  keeps working unchanged. */
export function defaultAbility(spec: EnemySpec): Ability {
  if (spec.ranged) {
    return {
      id: 'cast', minRange: 0, maxRange: spec.attackRange,
      windup: spec.windupTime, strike: spec.strikeTime, recover: spec.recoverTime,
      cooldown: spec.attackCooldown ?? 0, pose: 'cast',
      steps: [{ trigger: { at: 0 }, action: {
        kind: 'projectile', projectileId: spec.ranged.projectileId,
        muzzle: spec.ranged.muzzleOffset, damage: spec.attackDamage,
      } }],
    };
  }
  return {
    id: 'strike', minRange: 0, maxRange: spec.attackRange,
    windup: spec.windupTime, strike: spec.strikeTime, recover: spec.recoverTime,
    pose: 'swing', creep: true,
    steps: [{ trigger: { at: 0 }, action: {
      kind: 'melee', reach: spec.strikeRange, damage: spec.attackDamage,
      element: elementForDamageType(spec.damageType),
    } }],
  };
}

/** The enemy's abilities, highest-priority first. Explicit `spec.abilities`
 *  win; otherwise the legacy fields synthesize a single default. */
export function resolveAbilities(spec: EnemySpec): Ability[] {
  if (spec.abilities && spec.abilities.length > 0) return spec.abilities;
  return [defaultAbility(spec)];
}
