import type { EntityId } from '../ecs/types';
import { get } from '../ecs/world';
import { computeStats as playerStats } from '../player/equipment-stats';

// Damage pipeline. All damage in the game — player attacks on enemies, enemy
// attacks on player, future spells/traps/environmental — funnels through
// dealDamage(). One place computes the math; one place fires the effects;
// one place returns the result for UI/SFX.
//
// Design goals:
//   - SOURCE multipliers compose: weapon base + flat bonuses (Ring of
//     Predation +1) + multipliers (future Berserk buff x1.5).
//   - TARGET reduction is per-DAMAGE-TYPE: physical armor reduces physical,
//     magic armor reduces magic. Floors at 1 so even a heavily armored
//     target can't reduce to 0.
//   - Extending damage types is a one-line change. To add 'fire':
//       1. Add 'fire' to DamageType union
//       2. Add fireArmor field to CombatStats
//       3. Add the case in `armorFor()`
//     Done.

export type DamageType = 'physical' | 'magic';

/**
 * Combat-relevant stats for any entity. Player gets these from equipment +
 * (future) buffs. Enemies get them from EnemySpec defaults. NPCs/bosses
 * could get them from their spec or per-instance overrides.
 */
export interface CombatStats {
  // --- Outgoing (matters when this entity is a damage SOURCE) ---
  /** Flat amount added to every damage dealt by this entity. */
  damageBonus: number;
  /** Multiplicative factor on outgoing damage. 1.0 = unchanged. */
  damageMultiplier: number;

  // --- Incoming (matters when this entity is a damage TARGET) ---
  /** Flat reduction to incoming physical damage (floored at 1 final). */
  physicalArmor: number;
  /** Flat reduction to incoming magic damage (floored at 1 final). */
  magicArmor: number;
}

const DEFAULT_STATS: CombatStats = {
  damageBonus: 0,
  damageMultiplier: 1,
  physicalArmor: 0,
  magicArmor: 0,
};

// Per-entity static stats (set when the entity is created — used for enemies).
// Player stats come from equipment dynamically, so player is NOT in this map.
const enemyStats = new Map<EntityId, CombatStats>();

/** Register stats for an entity (typically called when an enemy spawns). */
export function setEntityCombatStats(id: EntityId, stats: Partial<CombatStats>) {
  enemyStats.set(id, { ...DEFAULT_STATS, ...stats });
}

export function clearEntityCombatStats(id: EntityId) {
  enemyStats.delete(id);
}

/**
 * Get combat stats for an entity. The 'player' entity reads from the
 * equipment stats module (live — reflects currently-equipped items).
 * Other entities read from the enemyStats map registered at spawn.
 */
export function getCombatStats(id: EntityId | null): CombatStats {
  if (id === 'player') {
    const p = playerStats();
    return {
      damageBonus: p.weaponDamageBonus,
      damageMultiplier: 1,
      physicalArmor: p.physicalArmor,
      magicArmor: p.magicArmor,
    };
  }
  if (id && enemyStats.has(id)) return enemyStats.get(id)!;
  return DEFAULT_STATS;
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

  const boosted = (event.base + src.damageBonus) * src.damageMultiplier;
  const armor = armorFor(tgt, event.type);
  const final = Math.max(1, Math.round(boosted - armor));
  return { applied: final, blocked: Math.max(0, boosted - final) };
}

function armorFor(stats: CombatStats, type: DamageType): number {
  switch (type) {
    case 'physical': return stats.physicalArmor;
    case 'magic':    return stats.magicArmor;
  }
}
