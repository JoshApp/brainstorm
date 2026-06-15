import type { EntityId } from '../ecs/types';
import { get } from '../ecs/world';
import { aggregateModifiers, computePlayerStats } from './modifiers';
import { resolveDamage } from './damage-math';

// Damage pipeline. All damage in the game — player attacks on enemies, enemy
// attacks on player, future spells/traps/environmental — funnels through
// computeDamage(). One place computes the math; the caller fires whatever
// presentation effects (vignette, hit-flash, damage numbers) it owns.
//
// Stats come from the unified modifier pipeline (combat/modifiers.ts):
// equipment + active buffs + (future) per-entity baselines + procs all
// produce StatModifier records that aggregate into the same CombatStats.
//
// Adding a damage type ('fire', 'cold', etc.) is a one-line change:
//   1. Add to DamageType union
//   2. Add per-type armor field in StatModifier + here in CombatStats
//   3. Add case in armorFor()

export type DamageType = 'physical' | 'magic';

export interface CombatStats {
  /** Flat amount added to every damage dealt by this entity. */
  damageBonus: number;
  /** Multiplicative factor on outgoing damage. 1.0 = unchanged. */
  damageMultiplier: number;
  /** Flat reduction to incoming physical damage (floored at 1 final). */
  physicalArmor: number;
  /** Flat reduction to incoming magic damage (floored at 1 final). */
  magicArmor: number;
  /** Multiplier on INCOMING damage (sunder/vulnerable). 1.0 = normal. */
  vulnerability: number;
}

const DEFAULT_STATS: CombatStats = {
  damageBonus: 0,
  damageMultiplier: 1,
  physicalArmor: 0,
  magicArmor: 0,
  vulnerability: 1,
};

// Per-entity BASELINE stats (set when an enemy spawns from its spec).
// Active buffs add on top via aggregateModifiers. Player isn't in this
// map — its base is CONFIG + equipment + buffs, all via the unified
// modifier pipeline.
const baselineStats = new Map<EntityId, CombatStats>();

/** Register baseline stats for an entity (typically called when an enemy spawns). */
export function setEntityCombatStats(id: EntityId, stats: Partial<CombatStats>) {
  baselineStats.set(id, { ...DEFAULT_STATS, ...stats });
}

export function clearEntityCombatStats(id: EntityId) {
  baselineStats.delete(id);
}

/**
 * Get the current combat stats for an entity — baseline + modifiers from
 * every active source (equipment slots for player, buffs for anyone).
 * Recomputed on each call; cheap at our scale.
 */
export function getCombatStats(id: EntityId | null): CombatStats {
  if (id === 'player') {
    // Player: baseline is implicit 0/1/0/0; modifier aggregation already
    // produced the structured player stats — translate to combat shape.
    const p = computePlayerStats();
    return {
      damageBonus: p.weaponDamageBonus,
      damageMultiplier: p.damageMultiplier,
      physicalArmor: p.physicalArmor,
      magicArmor: p.magicArmor,
      vulnerability: p.vulnerability,
    };
  }
  if (!id) return DEFAULT_STATS;

  // Enemy / other: start from baseline registered at spawn, then add
  // modifiers from any active buffs. Future intrinsic-passive stat
  // mods can just be added as additional modifier sources in
  // aggregateModifiers() — this function need not change.
  const base = baselineStats.get(id) ?? DEFAULT_STATS;
  let damageBonus = base.damageBonus;
  let damageMultiplier = base.damageMultiplier;
  let physicalArmor = base.physicalArmor;
  let magicArmor = base.magicArmor;
  let vulnerability = base.vulnerability;
  for (const m of aggregateModifiers(id)) {
    switch (m.kind) {
      case 'weapon-damage':     damageBonus += m.amount; break;
      case 'damage-multiplier': damageMultiplier *= m.amount; break;
      case 'physical-armor':    physicalArmor += m.amount; break;
      case 'magic-armor':       magicArmor += m.amount; break;
      case 'incoming-damage-mult': vulnerability *= m.amount; break;
      // max-hp not applicable to enemy combat stats (HP is in spawn-time pool)
      // finisher-damage-mult is player-side; speed mods handled by aggregateSpeed.
    }
  }
  return { damageBonus, damageMultiplier, physicalArmor, magicArmor, vulnerability };
}

export interface DamageEvent {
  /** Who dealt this damage. null = environmental (trap, fall, etc.). */
  source: EntityId | null;
  /** Who takes the damage. */
  target: EntityId;
  /** Pre-mitigation damage amount (typically weapon.damage for melee). */
  base: number;
  /** Damage type — determines which armor reduces it. */
  type: DamageType;
  /** True when this is a damage-over-time TICK (bleed/poison/burn) rather
   *  than a direct hit. Direct hits get their floating number from the
   *  attack / projectile caller; DoT ticks have no such caller, so the
   *  enemy's takeDamage emits an `enemy:dot` event for them instead. */
  dot?: boolean;
  /** Element tint (hex) for a DoT tick's floating number — the buff's colour
   *  (bleed red, poison green, burn orange). Only read when `dot` is set. */
  tint?: number;
  /** Id of the hurtbox ZONE this hit struck ('head' | 'body' | …). Carried so
   *  a KILLING blow can dismember the matching joint (head zone → behead). */
  hitZoneId?: string;
  /** Side the killing SLASH travelled ('L' = strafe-left, 'R' = strafe-right).
   *  A side-slash kill lops a limb on that side even when the struck zone was
   *  the torso — angle-based dismemberment. Undefined for thrusts / neutral. */
  severSide?: 'L' | 'R';
}

export interface DamageResult {
  /** Amount actually applied (after armor reduction, floored at 1). */
  applied: number;
  /** Amount blocked by armor (for floating "blocked" text if we want). */
  blocked: number;
  /** Whether this hit reduced target HP to 0. Set by the apply-side. */
  killed: boolean;
  type: DamageType;
  source: EntityId | null;
  target: EntityId;
}

/**
 * Compute the final damage for an event, given source multipliers + target
 * armor. Does NOT apply it to HP — that's the caller's responsibility (the
 * caller has the HP-bearing object: enemy / player health module).
 *
 * Why split: the apply-side wants to fire its own effects (vignette for
 * player, hit-flash for enemy, etc.) — better to let it do that with the
 * final number than have the pipeline reach into both subsystems.
 */
export function computeDamage(event: DamageEvent): { applied: number; blocked: number } {
  const src = getCombatStats(event.source);
  const tgt = getCombatStats(event.target);
  const r = resolveDamage(event.base, src.damageBonus, src.damageMultiplier, armorFor(tgt, event.type));
  // Sunder/vulnerable amplifies the FINAL (post-armor) damage. Floored
  // at 1 like the rest of the pipeline. No-op when vulnerability is 1.
  if (tgt.vulnerability !== 1) {
    const amped = Math.max(1, Math.round(r.applied * tgt.vulnerability));
    return { applied: amped, blocked: r.blocked };
  }
  return r;
}

function armorFor(stats: CombatStats, type: DamageType): number {
  switch (type) {
    case 'physical': return stats.physicalArmor;
    case 'magic':    return stats.magicArmor;
  }
}

// ── Damage sinks — route damage through full death handling ──────────
//
// computeDamage() only does the MATH; HP mutation + the death sequence
// (drops, kill event, removal, player death) live in the wrappers
// (enemy.takeDamage, player health). A damage-over-time tick must go
// through those same wrappers so a poison kill drops loot + credits the
// kill, and a burn can actually kill the player. Each enemy registers
// its takeDamage; the player registers its health sink. applyDamageVia
// dispatches to them — falling back to a raw HP mutation only for
// entities with no wrapper (plain props), which never matters for DoTs.

type DamageSink = (event: DamageEvent) => number;
const damageSinks = new Map<EntityId, DamageSink>();

export function registerDamageSink(id: EntityId, fn: DamageSink): void {
  damageSinks.set(id, fn);
}
export function unregisterDamageSink(id: EntityId): void {
  damageSinks.delete(id);
}

/** Apply a damage event through the target's registered handler so its
 *  death is fully resolved. Returns the amount applied. */
export function applyDamageVia(event: DamageEvent): number {
  const sink = damageSinks.get(event.target);
  if (sink) return sink(event);
  // Fallback — raw HP, no death sequence (legacy behaviour for entities
  // without a wrapper). DoT targets (enemies/player) always have one.
  const e = get(event.target);
  if (!e?.hp) return 0;
  const { applied } = computeDamage(event);
  e.hp.current = Math.max(0, e.hp.current - applied);
  return applied;
}
